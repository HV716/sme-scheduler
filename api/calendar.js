// Uses a stored Google OAuth refresh token to mint a fresh access token, then
// creates one calendar event per approved session. This is a single-user
// integration -- it always writes to the calendar belonging to whichever
// Google account authorized the refresh token, not a per-visitor calendar.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    return res.status(500).json({ error: "Google Calendar credentials are not fully configured in Vercel environment variables." });
  }

  const { events } = req.body || {};
  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: "Missing or empty 'events' array in request body." });
  }

  // Step 1: exchange the long-lived refresh token for a short-lived access token.
  let accessToken;
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: GOOGLE_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) {
      return res.status(tokenResponse.status).json({ error: `Token refresh failed: ${JSON.stringify(tokenData)}` });
    }
    accessToken = tokenData.access_token;
  } catch (err) {
    return res.status(500).json({ error: `Token refresh request failed: ${String(err)}` });
  }

  // Step 2: create one calendar event per session, collecting per-item results
  // rather than failing the whole batch if one event has a problem.
  const results = [];
  for (const ev of events) {
    try {
      const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          summary: ev.summary,
          description: ev.description || "",
          start: { dateTime: ev.startTime, timeZone: "Asia/Kolkata" },
          end: { dateTime: ev.endTime, timeZone: "Asia/Kolkata" },
        }),
      });
      const data = await response.json();
      if (response.ok) {
        results.push({ summary: ev.summary, success: true, eventId: data.id, htmlLink: data.htmlLink });
      } else {
        results.push({ summary: ev.summary, success: false, error: data.error?.message || JSON.stringify(data) });
      }
    } catch (err) {
      results.push({ summary: ev.summary, success: false, error: String(err) });
    }
  }

  return res.status(200).json({ results });
}
