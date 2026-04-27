# Project Biography: Liberia Students Association (LSA) Global Registry

## Overview
The **LSA Global Registry** is a comprehensive, secure, and modern digital platform built specifically to support and organize Liberian scholars, alumni, and leaders globally. Moving away from generic school-themed templates, this web application serves as the official digital infrastructure for the organization, prioritizing data integrity, seamless user experience, and authentic representation of the Liberian identity.

---

## 🎨 Branding & Design System
The visual identity of the global registry is heavily rooted in the national pride of Liberia:
* **Color Palette**: Integrated strict adherence to the **Liberian flag colors**, utilizing *Liberian Blue* (`#002868`) and *Liberian Red* (`#bf0a30`) as the primary accents, balanced natively against deep navies, clean whites, and soft grays.
* **Modern Interface**: Designed using Vanilla CSS to implement structural glassmorphism, soft drop shadows (`var(--shadow-lg)`), and smooth micro-animations on hover interactions to create a premium, authoritative feel.
* **Hero Slider**: A custom-built Vanilla JavaScript image carousel in the hero section dynamically rotates through various images of LSA members. It reacts to mouse hover on Desktop and switches to a fully automatic slide interval on Mobile devices.

---

## 💻 Frontend Architecture (UI/UX Journey)
The user interface is broken down into a dedicated flow designed to protect member data and ensure valid registrations.

### 1. The Landing Page (`index.html`)
Serves as the public face containing the organization's Mission, Vision, and Purpose, alongside the automatic image slider. It prompts new users to "Join the Registry."

### 2. The Secure Dashboard (`dashboard.html`)
A secondary layer of verification. Recognizing the sensitive nature of international student tracking, the digital infrastructure is gated behind a rigorous **Email OTP Identity Verification** system.
* *Functionality*: Powered by a Node.js Express backend and Nodemailer. Users input their email address, triggering a secure, time-sensitive 4-digit code (e.g., `LSA1234`) delivered directly to their inbox. 
* *Flow*: The UI utilizes modern micro-animations to seamlessly transition between the Email Input and the split-box OTP Entry form. Successful verification unlocks the restricted **Sign Up** gateway, while the **Login** portal remains accessible alongside the verification flow for returning users.

### 3. The Multi-Step Registration (`signup.html`)
A robust workflow built to cleanly capture high-integrity data.
* **Security Validation**: Live, real-time password checking ensuring users include uppercase, lowercase, numbers, and special characters before proceeding.
* **Role Typology**: Users classify strictly as a **Current Student** or **Alumni**. 
* **Dynamic Forms**: Loads highly specific database fields based on the selected role (e.g. Students enter *Duration of Study*, while Alumni enter *Position Served*).
* **Local State**: Temporarily securely caches exactly what the user authored directly into the browser's LocalStorage memory as a JSON object, simulating a backend POST request.

### 4. The Member Login & Profiles (`login.html`)
The secure portal for previously registered users to retrieve their data.
* **Authentication**: Verifies entered credentials directly against the cached registry.
* **Data Rendering**: Upon success, dynamically generates a clean list containing the user's specific database fields exactly as they filled them out.
* **Official Registry Download**: Includes an automated JavaScript compiler that generates an official `LSA_Official_Record.txt` (or PDF equivalent) document and forces an automatic download to the user's local machine for their personal records.

---

## 🗄️ Backend & Database Architecture
The backend is powered by a locally connected **PostgreSQL** (`Port: 5432`) database managed by a dedicated Node.js setup script (`setup.js`).

### Core Schema Design
1. **Students & Alumni Tables**: Isolated tables specifically built to house the varying data fields of the two member types seamlessly. Includes fields referencing alphanumeric College IDs, passport metrics, etc.
2. **Auto-ID Sequences**: A custom PostgreSQL trigger mechanism automatically generates unique Association IDs (`LSA-101`, `LSA-102`...) specifically and *only* when an Administrator verifies a pending account.
3. **Dynamic Birthdate Views**: To protect privacy, `DOB` is stored raw, but restricted `admin_views` dynamically calculate exactly how old the user is natively in PostgreSQL, preventing developers from having to maintain "Age" columns.
4. **Automated Audit Logging**: Every single `UPDATE` or `VERIFY` action performed by an admin seamlessly triggers an isolated `INSERT` into the `audit_logs` table, storing exactly what the data was *before* the change and what it became *after*, ensuring absolute accountability over the database.

---

## 📋 Development Progress Summary

### Completed Features (As of April 2026)

1. **Frontend Pages**
   - Landing page (`index.html`) with hero slider and mission/vision sections
   - Secure dashboard (`dashboard.html`) with access code protection (`LSA@SOA`)
   - Multi-step registration (`signup.html`) with real-time password validation
   - Login portal (`login.html`) with profile rendering and official record download

2. **Backend Infrastructure**
   - Express.js server with CORS and static file serving
   - PostgreSQL database connection (`LSA-Database` on port 5432)
   - OTP-based authentication system with 4-digit codes (`LSA` prefix)
   - Rate limiting (max 2 attempts per 10 minutes)
   - 60-second resend cooldown for OTPs

3. **Email System**
   - Nodemailer integration with Gmail SMTP
   - Professional HTML email templates with glassmorphism aesthetic
   - Dark mode themed verification emails using Liberian colors

4. **Security Features**
   - In-memory OTP storage with expiration (120 seconds)
   - IP address logging for audit trails
   - Database logging for all OTP events (SENT, EXPIRED, VERIFIED)
   - Password validation requiring uppercase, lowercase, numbers, and special characters

5. **Database Schema**
   - `otp_logs` table for tracking email verification attempts
   - Students and Alumni tables with role-specific fields
   - Auto-ID sequences for Association IDs (LSA-101, LSA-102...)
   - Dynamic birthdate views for privacy protection

### Project Structure
```
/Web-Code
├── index.html          # Landing page
├── dashboard.html      # Secure gateway
├── signup.html         # Registration
├── login.html          # Authentication
├── server.js           # Express backend
├── setup.js            # Database setup
├── run_sql.js          # SQL execution
├── script.js           # Client-side scripts
├── styles.css          # Global styles
├── Database_schema.sql # DB schema
├── package.json        # Dependencies
└── Images/            # Assets
```

### Technologies Used
- **Frontend**: Vanilla HTML, CSS, JavaScript
- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL
- **Email**: Nodemailer with Gmail SMTP
- **Security**: express-rate-limit, OTP verification
