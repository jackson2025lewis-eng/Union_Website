/**
 * Vercel Serverless Function Proxy for LSU Odisha Backend
 * Proxies frontend requests to Google Apps Script Web App (backed by Google Sheets & Google Drive)
 */

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx65PRCECX0_xq-N9cpygnhG24rC0cYfW7V5PCYNMjEDmDSg9zuv3Mfy75QYeEtoLbfGw/exec';

module.exports = async function handler(req, res) {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Validate HTTP method
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: `Method ${req.method} not allowed. Only POST requests are supported.`
    });
  }

  // Parse payload robustly
  let payload = req.body;

  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (parseErr) {
      return res.status(400).json({
        success: false,
        message: 'Invalid JSON request payload.'
      });
    }
  } else if (Buffer.isBuffer(payload)) {
    try {
      payload = JSON.parse(payload.toString('utf-8'));
    } catch (parseErr) {
      return res.status(400).json({
        success: false,
        message: 'Invalid JSON request payload buffer.'
      });
    }
  } else if (!payload && req.readable) {
    try {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const rawText = Buffer.concat(chunks).toString('utf-8');
      payload = rawText ? JSON.parse(rawText) : {};
    } catch (streamErr) {
      return res.status(400).json({
        success: false,
        message: 'Failed to read JSON request stream.'
      });
    }
  }

  if (!payload || typeof payload !== 'object') {
    payload = {};
  }

  // Forward request to Google Apps Script
  try {
    const upstreamResponse = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      redirect: 'follow'
    });

    const responseText = await upstreamResponse.text();
    let data;

    try {
      data = JSON.parse(responseText);
    } catch (jsonErr) {
      console.error('Non-JSON response from Google Apps Script:', responseText);
      return res.status(502).json({
        success: false,
        message: 'The upstream Google Apps Script backend returned an invalid non-JSON response.',
        details: responseText.slice(0, 300)
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Error forwarding request to Google Apps Script:', error);
    return res.status(502).json({
      success: false,
      message: 'Unable to connect to the backend server. Please try again later.'
    });
  }
};

module.exports.default = module.exports;
