import nodemailer from 'nodemailer';
import { Client } from 'pg';
import admin from 'firebase-admin';

if (!admin.apps.length) {
    try {
        const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) : null;
        if (serviceAccount) {
            admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        } else {
            console.warn("WARNING: FIREBASE_SERVICE_ACCOUNT missing. Token validation will be bypassed locally.");
            admin.initializeApp();
        }
    } catch (error) {
        console.error("Firebase Admin Init Error:", error);
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { email } = req.body;
    const authHeader = req.headers.authorization;

    if (!email) return res.status(400).json({ error: 'Email is required' });

    if (process.env.FIREBASE_SERVICE_ACCOUNT && authHeader && authHeader.startsWith('Bearer ')) {
        const idToken = authHeader.split('Bearer ')[1];
        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            if (decodedToken.email !== email) {
                return res.status(403).json({ error: 'Unauthorized: Token email mismatch' });
            }
        } catch (error) {
            return res.status(403).json({ error: 'Unauthorized: Invalid Firebase ID Token' });
        }
    }

    const client = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    try {
        await client.connect();

        const recentLog = await client.query(
            "SELECT created_at FROM otp_logs WHERE email_address = $1 AND status LIKE 'SENT:%' ORDER BY created_at DESC LIMIT 1",
            [email]
        );
        
        if (recentLog.rows.length > 0) {
            const lastSent = new Date(recentLog.rows[0].created_at).getTime();
            if (Date.now() - lastSent < 60000) {
                return res.status(429).json({ error: 'Please wait 60 seconds before requesting a new code.' });
            }
        }

        const chars = '0123456789';
        let otp = '';
        for (let i = 0; i < 4; i++) otp += chars.charAt(Math.floor(Math.random() * chars.length));
        
        await client.query(
            "INSERT INTO otp_logs (email_address, ip_address, status) VALUES ($1, $2, $3)",
            [email, req.headers['x-forwarded-for'] || '127.0.0.1', `SENT:${otp}`]
        );

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        const emailTemplate = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: 'Outfit', sans-serif; background: #001a4d; color: #ffffff; padding: 40px; margin: 0; }
                .container { max-width: 600px; margin: 0 auto; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-top: 6px solid #bf0a30; border-radius: 12px; padding: 40px; text-align: center; }
                .otp-code { font-size: 32px; font-weight: 700; color: #ffffff; background: rgba(255, 255, 255, 0.1); padding: 15px 30px; border-radius: 8px; display: inline-block; margin: 20px 0; letter-spacing: 4px; border: 1px solid rgba(255, 255, 255, 0.2); }
                .text { font-size: 16px; color: rgba(255, 255, 255, 0.8); line-height: 1.6; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>LSA Global Registry</h2>
                <p class="text">We received a request to securely access your account.</p>
                <div class="otp-code">LSA-${otp}</div>
                <p class="text"><strong>This code is valid for 5 minutes.</strong></p>
            </div>
        </body>
        </html>`;

        await transporter.sendMail({
            from: '"LSA Global Registry" <' + process.env.EMAIL_USER + '>',
            to: email,
            subject: 'Your LSA Security Verification Code',
            html: emailTemplate
        });

        res.status(200).json({ success: true, message: 'OTP Sent successfully' });

    } catch (error) {
        console.error("OTP Error:", error);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        await client.end();
    }
}
