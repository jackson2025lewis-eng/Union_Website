const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzZyI7gERGia6KDLpN_cp-S2OL4Tr7eOVL0vo9lWC3MILFJIIaVqjLs7jPG3Lpd_T_YIg/exec";

module.exports = async function handler(req, res) {
  // Allow only POST requests from the frontend.
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      message: "Method not allowed. Use POST."
    });
  }

  try {
    let payload = req.body;

    // Handle requests where the body arrives as a JSON string.
    if (typeof payload === "string") {
      payload = JSON.parse(payload);
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return res.status(400).json({
        success: false,
        message: "Invalid request payload."
      });
    }

    if (!payload.action) {
      return res.status(400).json({
        success: false,
        message: "Missing action in request payload."
      });
    }

    // Forward the request to the latest Apps Script deployment.
    const upstreamResponse = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      redirect: "follow"
    });

    const responseText = await upstreamResponse.text();

    let result;

    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.error(
        "Apps Script returned a non-JSON response. HTTP status:",
        upstreamResponse.status
      );

      return res.status(502).json({
        success: false,
        message:
          "The Apps Script backend returned an unexpected response. Check the Apps Script deployment and execution logs."
      });
    }

    // Preserve the Apps Script result for the frontend.
    return res.status(200).json(result);

  } catch (error) {
    console.error("LSU backend proxy error:", error.message);

    return res.status(502).json({
      success: false,
      message: "Unable to communicate with the LSU backend. Please try again."
    });
  }
};