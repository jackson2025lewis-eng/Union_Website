const express = require('express');
const cors = require('cors');
const { Client } = require('pg');
const rateLimit = require('express-rate-limit');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from root directory
app.use(express.static(__dirname));
app.use('/styles.css', express.static(path.join(__dirname, 'styles.css')));
app.use('/script.js', express.static(path.join(__dirname, 'script.js')));
app.use('/images', express.static(path.join(__dirname, 'images')));

// Serve index.html at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve other HTML pages
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'Dashboard.html'));
});
app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'signup.html'));
});
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// DB Connection Settings
const dbConfig = {
    connectionString: process.env.SUPBASE_DB_URL,
};

// Nodemailer Transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Rate limiter: Max 2 attempts per 10 mins
const otpLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, 
    max: 2, 
    message: { error: 'Too many requests, please try again in 10 minutes.' }
});

// In-memory store for OTPs
const otpStorage = new Map();

function generateOTP() {
    const chars = '0123456789';
    let nums = '';
    for (let i = 0; i < 4; i++) nums += chars.charAt(Math.floor(Math.random() * chars.length));
    return 'LSA' + nums;
}

app.post('/api/otp/send', otpLimiter, async (req, res) => {
    const { email } = req.body;
    let ip = req.ip || req.connection.remoteAddress;
    
    // Clean IP for localhost
    if (ip === '::1') ip = '127.0.0.1';

    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const otp = generateOTP();
    const expiresAt = Date.now() + 120 * 1000; // 120 secs
    
    // 60-second resend cooldown check
    const existing = otpStorage.get(email);
    if (existing && Date.now() < existing.cooldown) {
        return res.status(429).json({ error: 'Please wait 60 seconds before requesting a new code.' });
    }

    otpStorage.set(email, { otp, expiresAt, cooldown: Date.now() + 60 * 1000, attempts: 0 });

    // Log to DB
    const client = new Client(dbConfig);
    try {
        await client.connect();
        await client.query(
            'INSERT INTO otp_logs (email_address, ip_address, status) VALUES ($1, $2, $3)',
            [email, ip, 'SENT']
        );
    } catch (e) {
        console.error('Database logging error:', e);
    } finally {
        await client.end();
    }

    // Professional HTML Email Template with a dark mode/glassmorphism aesthetic
    const emailTemplate = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Outfit', sans-serif; background: radial-gradient(circle at top left, #001a4d, #000a1c); color: #ffffff; padding: 40px; margin: 0; }
        .container { max-width: 600px; margin: 0 auto; background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.1); border-top: 6px solid #bf0a30; border-radius: 12px; padding: 40px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); text-align: center; }
        .otp-code { font-size: 32px; font-weight: 700; color: #ffffff; background: rgba(255, 255, 255, 0.1); padding: 15px 30px; border-radius: 8px; display: inline-block; margin: 20px 0; letter-spacing: 4px; border: 1px solid rgba(255, 255, 255, 0.2); }
        .text { font-size: 16px; color: rgba(255, 255, 255, 0.8); line-height: 1.6; }
        .footer { margin-top: 30px; font-size: 12px; color: rgba(255, 255, 255, 0.4); border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h2 style="margin-top: 0;">LSA Global Registry</h2>
        <p class="text">Dear User,</p>
        <p class="text">We received a request to access your account. Please use the verification code below to securely log in:</p>
        <div class="otp-code">${otp}</div>
        <p class="text"><strong>This code is valid for 1 minute.</strong><br>For security, do not share this code with anyone.</p>
        <div class="footer">
            &copy; ${new Date().getFullYear()} Liberian Students Association. All rights reserved.<br>
            If you did not request this, please ignore this email.
        </div>
    </div>
</body>
</html>`;

    // Send Email via Nodemailer
    try {
        await transporter.sendMail({
            from: `"LSA Global Registry" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Your LSA Security Verification Code',
            html: emailTemplate
        });
        console.log(`\n============== EMAIL SENT ==============\n` +
                    `TO: ${email}\n` +
                    `Code: ${otp}\n` +
                    `======================================\n`);
        res.json({ success: true, message: 'OTP Sent successfully.' });
    } catch (err) {
        console.error('Email sending error:', err);
        // Fallback to error response if email fails
        res.status(500).json({ error: 'Failed to deliver OTP email. Please verify backend credentials.' });
    }
});

app.post('/api/otp/verify', async (req, res) => {
    const { email, code } = req.body;
    let ip = req.ip || req.connection.remoteAddress;
    if (ip === '::1') ip = '127.0.0.1';
    
    if (!email || !code) return res.status(400).json({ error: 'Email and code are required.' });

    const record = otpStorage.get(email);
    if (!record) return res.status(400).json({ error: 'No OTP requested for this email.' });

    const client = new Client(dbConfig);
    await client.connect();

    if (Date.now() > record.expiresAt) {
        otpStorage.delete(email);
        await client.query('INSERT INTO otp_logs (email_address, ip_address, status) VALUES ($1, $2, $3)', [email, ip, 'EXPIRED']);
        await client.end();
        return res.status(400).json({ error: 'OTP has expired.' });
    }

    if (record.otp !== code) {
        record.attempts += 1;
        await client.query('INSERT INTO otp_logs (email_address, ip_address, status, attempt_count) VALUES ($1, $2, $3, $4)', [email, ip, 'FAILED', record.attempts]);
        await client.end();
        
        const remaining = 3 - record.attempts;
        if (remaining <= 0) {
            otpStorage.delete(email);
            return res.status(400).json({ error: 'Maximum attempts reached. Please request a new OTP.' });
        }
        return res.status(400).json({ error: `Invalid Code: ${remaining} attempt(s) remaining` });
    }

    // Success
    otpStorage.delete(email);
    await client.query('INSERT INTO otp_logs (email_address, ip_address, status) VALUES ($1, $2, $3)', [email, ip, 'VERIFIED']);
    await client.end();

    res.json({ success: true, message: 'Verified successfully.' });
});

// Start Server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Dedicated LSA Secure OTP server running on http://localhost:${PORT}`);
});
