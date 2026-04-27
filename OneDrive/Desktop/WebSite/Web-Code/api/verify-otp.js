import { Client } from 'pg';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { email, code } = req.body;
    
    if (!email || !code) return res.status(400).json({ error: 'Email and code are required' });
    
    const otpCode = code.replace('LSA-', '');

    const client = new Client({ connectionString: process.env.SUPABASE_DB_URL });
    try {
        await client.connect();

        // Find the most recent SENT log for this email
        const recentLog = await client.query(
            "SELECT id, status, created_at FROM otp_logs WHERE email_address = $1 AND status LIKE 'SENT:%' ORDER BY created_at DESC LIMIT 1",
            [email]
        );

        if (recentLog.rows.length === 0) {
            return res.status(400).json({ error: 'No OTP requested for this email' });
        }

        const logRecord = recentLog.rows[0];
        const sentTime = new Date(logRecord.created_at).getTime();
        
        // Check expiration (5 minutes = 300,000 ms)
        if (Date.now() - sentTime > 300000) {
            await client.query("INSERT INTO otp_logs (email_address, ip_address, status) VALUES ($1, $2, $3)", [email, req.headers['x-forwarded-for'] || '127.0.0.1', 'EXPIRED']);
            return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
        }

        const expectedCode = logRecord.status.split(':')[1];

        if (expectedCode !== otpCode) {
            // Count failed attempts
            const failedLogs = await client.query(
                "SELECT COUNT(*) FROM otp_logs WHERE email_address = $1 AND status = 'FAILED' AND created_at > $2",
                [email, logRecord.created_at]
            );
            const attempts = parseInt(failedLogs.rows[0].count) + 1;

            await client.query("INSERT INTO otp_logs (email_address, ip_address, status, attempt_count) VALUES ($1, $2, $3, $4)", [email, req.headers['x-forwarded-for'] || '127.0.0.1', 'FAILED', attempts]);

            if (attempts >= 3) {
                return res.status(400).json({ error: 'Maximum attempts reached. Please request a new OTP.' });
            }
            return res.status(400).json({ error: \`Invalid Code. \${3 - attempts} attempt(s) remaining\` });
        }

        // Success
        await client.query("INSERT INTO otp_logs (email_address, ip_address, status) VALUES ($1, $2, $3)", [email, req.headers['x-forwarded-for'] || '127.0.0.1', 'VERIFIED']);

        res.status(200).json({ success: true, message: 'OTP Verified successfully' });

    } catch (error) {
        console.error("OTP Verify Error:", error);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        await client.end();
    }
}
