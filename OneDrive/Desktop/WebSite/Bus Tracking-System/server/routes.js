const express = require("express");
const router = express.Router();
const db = require("./db");

// Get all routes
router.get(["/routes", "/api/routes"], async (req, res) => {
  try {
    const result = await db.query(`
      SELECT route_id, route_name, status
      FROM routes
      ORDER BY route_id
    `);

    res.json(result.rows || []);
  } catch (error) {
    console.error("Error fetching routes from the database:", error);
    res.status(500).json({
      message: "Error fetching routes from the database",
      error: error.message,
    });
  }
});

// Get stops for a route
router.get(["/routes/:id/stops", "/api/routes/:id/stops"], async (req, res) => {
  const routeId = req.params.id;
  try {
    const result = await db.query(`
      SELECT stop_id, stop_name, latitude, longitude
      FROM stops
      WHERE route_id = $1
      ORDER BY stop_id
    `, [routeId]);

    res.json(result.rows || []);
  } catch (error) {
    console.error(`Error fetching stops for route ${routeId} from the database:`, error);
    res.status(500).json({
      message: "Error fetching stops from the database",
      error: error.message,
    });
  }
});

// Start a new trip
router.post(["/trips", "/api/trips"], async (req, res) => {
  const { route_id, trip_type } = req.body;
  try {
    // Complete any existing active trips for this route to prevent duplicates
    await db.query(`
      UPDATE trips
      SET status = 'Completed', ended_at = NOW()
      WHERE route_id = $1 AND status = 'Active'
    `, [route_id]);

    const result = await db.query(`
      INSERT INTO trips (route_id, trip_type, status, started_at)
      VALUES ($1, $2, 'Active', NOW())
      RETURNING trip_id
    `, [route_id, trip_type]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating trip:", error);
    res.status(500).json({ message: "Error creating trip", error: error.message });
  }
});

// Update live location for a trip
router.post(["/trips/:id/location", "/api/trips/:id/location"], async (req, res) => {
  const tripId = req.params.id;
  const { latitude, longitude, speed } = req.body;
  try {
    await db.query(`
      INSERT INTO live_locations (trip_id, latitude, longitude, speed, recorded_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, [tripId, latitude, longitude, speed || 0]);

    res.json({ message: "Location updated successfully" });
  } catch (error) {
    console.error(`Error updating location for trip ${tripId}:`, error);
    res.status(500).json({ message: "Error updating location", error: error.message });
  }
});

// Get live location for a route
router.get(["/routes/:id/live", "/api/routes/:id/live"], async (req, res) => {
  const routeId = req.params.id;
  try {
    const result = await db.query(`
      SELECT ll.latitude, ll.longitude, ll.speed, ll.recorded_at, t.trip_id
      FROM trips t
      JOIN live_locations ll ON t.trip_id = ll.trip_id
      WHERE t.route_id = $1 AND t.status = 'Active'
      ORDER BY ll.recorded_at DESC
      LIMIT 1
    `, [routeId]);

    res.json(result.rows[0] || null);
  } catch (error) {
    console.error(`Error fetching live location for route ${routeId}:`, error);
    res.status(500).json({ message: "Error fetching live location", error: error.message });
  }
});

// Get config parameters (e.g. Google Maps API Key)
router.get(["/config", "/api/config"], (req, res) => {
  res.json({
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || ""
  });
});

module.exports = router;
