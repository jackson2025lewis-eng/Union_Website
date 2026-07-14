import { homeView } from "../views/home.js";
import { studentView } from "../views/student.js";
import { driverView } from "../views/driver.js";
import { trackingView } from "../views/tracking.js";
import { getRoutes, getRouteStops, startTrip, updateLiveLocation, getLiveLocation } from "./api.js";
import { loadGoogleMaps } from "./mapLoader.js";

const app = document.getElementById("app");

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
}

async function populateRouteDropdown(select) {
    select.replaceChildren(new Option("Loading routes…", ""));
    select.disabled = true;

    try {
        const routes = await getRoutes();
        select.replaceChildren(new Option("Select a route/destination", "", true, true));

        routes.forEach((route) => {
            const routeId = route.route_id ?? route.id;
            const routeName = route.route_name ?? route.name ?? routeId;

            if (routeId === undefined || !routeName) return;

            select.add(new Option(routeName, routeId));
        });

        if (routes.length === 0) {
            select.replaceChildren(new Option("No routes available", ""));
            return;
        }

        select.disabled = false;
    } catch (error) {
        console.error("Failed to load routes", error);
        select.replaceChildren(new Option(`Unable to load routes: ${error.message}`, ""));
    }
}

export function showHome() {
    if (!app) return;

    app.innerHTML = homeView();

    document.getElementById("studentBtn")?.addEventListener("click", showStudent);
    document.getElementById("driverBtn")?.addEventListener("click", showDriver);
}

export async function showStudent() {
    if (!app) return;
    app.innerHTML = studentView();

    const routeSelect = document.getElementById("route");
    if (!routeSelect) return;

    await populateRouteDropdown(routeSelect);

    document.getElementById("backBtn")?.addEventListener("click", showHome);

    document.getElementById("trackBtn")?.addEventListener("click", () => {
        const routeId = routeSelect.value;
        const journey = document.querySelector('input[name="journey"]:checked')?.value;

        if (!routeId) {
            alert("Please select a route/destination first!");
            return;
        }

        showTracking("student", routeId, journey);
    });
}

export async function showDriver() {
    if (!app) return;
    app.innerHTML = driverView();

    const routeSelect = document.getElementById("driverRoute");
    if (!routeSelect) return;

    await populateRouteDropdown(routeSelect);

    document.getElementById("backBtn")?.addEventListener("click", showHome);

    document.getElementById("shareBtn")?.addEventListener("click", () => {
        const routeId = routeSelect.value;
        const journey = document.querySelector('input[name="driverJourney"]:checked')?.value;

        if (!routeId) {
            alert("Please select your route/destination first!");
            return;
        }

        showTracking("driver", routeId, journey);
    });
}

async function showTracking(role, routeId, journey) {
    if (!app) return;

    // Get selected route/destination name
    const routeSelect = document.getElementById(role === "driver" ? "driverRoute" : "route");
    const routeName = routeSelect.options[routeSelect.selectedIndex].text;

    app.innerHTML = trackingView(role);

    // Populate static text elements
    document.getElementById("infoRoute").innerText = routeName;
    document.getElementById("infoStop").innerText = routeName;
    document.getElementById("infoJourney").innerText = journey;

    let watchId = null;
    let intervalId = null;
    let busMarker = null;
    let studentMarker = null;
    let studentPos = null;

    try {
        // 1. Load Google Maps script and construct map
        const maps = await loadGoogleMaps();
        const map = new maps.Map(document.getElementById('map'), {
            zoom: 14,
            center: { lat: 20.296, lng: 85.824 },
            disableDefaultUI: false,
            zoomControl: true
        });

        // Map selected routeId to corresponding stop name to highlight it
        const routeToStopMap = {
            "1": "ITER Main Gate",
            "2": "SOA Campus 2",
            "3": "SOA Campus 5"
        };
        const targetStopName = routeToStopMap[routeId];

        // 2. Fetch and Plot Route Stops (Points)
        const stops = await getRouteStops(1);
        const stopCoordinates = [];

        stops.forEach((stop) => {
            const lat = parseFloat(stop.latitude);
            const lng = parseFloat(stop.longitude);
            if (isNaN(lat) || isNaN(lng)) return;

            stopCoordinates.push([lat, lng]);

            const isSelected = targetStopName && stop.stop_name.toLowerCase().includes(targetStopName.toLowerCase().split(" ")[0]);
            
            // Plot stops as circle symbols on Google Maps
            const stopMarkerObj = new maps.Marker({
                position: { lat, lng },
                map: map,
                title: stop.stop_name,
                icon: {
                    path: maps.SymbolPath.CIRCLE,
                    scale: isSelected ? 9 : 6,
                    fillColor: isSelected ? '#10b981' : '#3b82f6', // Green for selected target, Blue for others
                    fillOpacity: 0.9,
                    strokeColor: '#ffffff',
                    strokeWeight: 2
                }
            });

            const infoWindow = new maps.InfoWindow({
                content: `<b>Location:</b> ${stop.stop_name}${isSelected ? ' (Your Target)' : ''}`
            });
            stopMarkerObj.addListener('click', () => {
                infoWindow.open(map, stopMarkerObj);
            });
        });

        // Draw connecting polyline path
        if (stopCoordinates.length > 1) {
            const pathLine = new maps.Polyline({
                path: stopCoordinates.map(coord => ({ lat: coord[0], lng: coord[1] })),
                geodesic: true,
                strokeColor: '#2563eb',
                strokeOpacity: 0.8,
                strokeWeight: 4
            });
            pathLine.setMap(map);
        }

        // Adjust bounds function to keep stops, student, and bus in view
        const adjustBounds = () => {
            const bounds = new maps.LatLngBounds();
            stopCoordinates.forEach(coord => {
                bounds.extend({ lat: coord[0], lng: coord[1] });
            });
            if (studentPos) {
                bounds.extend(studentPos);
            }
            if (busMarker) {
                bounds.extend(busMarker.getPosition());
            }
            map.fitBounds(bounds);
        };

        // Zoom map to show all stops initially
        adjustBounds();

        // 3. Setup Role-Specific Geolocation & Updates
        if (role === "driver") {
            const statusEl = document.getElementById("trackingStatus");
            const speedContainer = document.getElementById("speedContainer");
            const speedEl = document.getElementById("infoSpeed");

            statusEl.innerText = "Connecting trip to database...";

            // Create trip entry
            const trip = await startTrip(routeId, journey);
            const tripId = trip.trip_id;

            statusEl.innerText = "Sharing live location...";

            const sendLocationUpdate = (lat, lng, speed) => {
                updateLiveLocation(tripId, lat, lng, speed).catch(err => console.error("Error updating location:", err));
                
                const driverLatLng = { lat, lng };
                if (!busMarker) {
                    busMarker = new maps.Marker({
                        position: driverLatLng,
                        map: map,
                        title: "Your Location (Driver)",
                        icon: {
                            url: 'https://maps.google.com/mapfiles/ms/icons/bus.png',
                            scaledSize: new maps.Size(32, 32)
                        }
                    });
                } else {
                    busMarker.setPosition(driverLatLng);
                }
                map.panTo(driverLatLng);

                if (speedEl) {
                    speedEl.innerText = `${Math.round(speed || 0)} km/h`;
                    speedContainer.style.display = "block";
                }
            };

            // Geolocation logic
            if ("geolocation" in navigator) {
                watchId = navigator.geolocation.watchPosition(
                    (position) => {
                        const lat = position.coords.latitude;
                        const lng = position.coords.longitude;
                        const speed = (position.coords.speed || 0) * 3.6; // convert m/s to km/h
                        sendLocationUpdate(lat, lng, speed);
                    },
                    (error) => {
                        console.warn("GPS Geolocation failed. Starting simulated movement...", error);
                        startSimulatedSharing(stopCoordinates, sendLocationUpdate);
                    },
                    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
                );
            } else {
                startSimulatedSharing(stopCoordinates, sendLocationUpdate);
            }

            function startSimulatedSharing(coords, updateCallback) {
                statusEl.innerText = "Sharing simulated location (No GPS access)...";
                if (coords.length === 0) return;
                
                let idx = 0;
                updateCallback(coords[idx][0], coords[idx][1], 25);
                
                intervalId = setInterval(() => {
                    idx = (idx + 1) % coords.length;
                    const lat = coords[idx][0];
                    const lng = coords[idx][1];
                    const speed = 25 + Math.random() * 15;
                    updateCallback(lat, lng, speed);
                }, 5000);
            }

            document.getElementById("stopSharingBtn")?.addEventListener("click", () => {
                cleanup();
                showDriver();
            });

        } else if (role === "student") {
            const statusEl = document.getElementById("trackingStatus");
            const speedContainer = document.getElementById("speedContainer");
            const speedEl = document.getElementById("infoSpeed");

            // Fetch Student's own Location using Geolocation API
            if ("geolocation" in navigator) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        studentPos = {
                            lat: position.coords.latitude,
                            lng: position.coords.longitude
                        };

                        // Plot Student on the Map
                        studentMarker = new maps.Marker({
                            position: studentPos,
                            map: map,
                            title: "Your Location",
                            icon: {
                                path: maps.SymbolPath.FORWARD_CLOSED_ARROW,
                                scale: 5,
                                fillColor: '#8b5cf6', // Purple marker for student
                                fillOpacity: 1,
                                strokeColor: '#ffffff',
                                strokeWeight: 1.5
                            }
                        });

                        const studentInfoWindow = new maps.InfoWindow({
                            content: "<b>Your Location</b>"
                        });
                        studentMarker.addListener('click', () => {
                            studentInfoWindow.open(map, studentMarker);
                        });

                        adjustBounds();
                    },
                    (error) => {
                        console.warn("Could not retrieve student location:", error);
                    }
                );
            }

            const pollInterval = async () => {
                try {
                    const location = await getLiveLocation(routeId);
                    if (location) {
                        const lat = parseFloat(location.latitude);
                        const lng = parseFloat(location.longitude);
                        const speed = parseFloat(location.speed);
                        const busLatLng = { lat, lng };

                        if (speedEl) {
                            speedEl.innerText = `${Math.round(speed || 0)} km/h`;
                            speedContainer.style.display = "block";
                        }

                        if (!busMarker) {
                            busMarker = new maps.Marker({
                                position: busLatLng,
                                map: map,
                                title: "Bus Location",
                                icon: {
                                    url: 'https://maps.google.com/mapfiles/ms/icons/bus.png',
                                    scaledSize: new maps.Size(32, 32)
                                }
                            });
                        } else {
                            busMarker.setPosition(busLatLng);
                        }

                        // Calculate and display student-to-driver distance
                        if (studentPos) {
                            const distance = calculateDistance(studentPos.lat, studentPos.lng, lat, lng);
                            statusEl.innerText = `Bus is active. Distance to you: ${distance.toFixed(2)} km`;
                        } else {
                            statusEl.innerText = "Bus is active. Tracking real-time location...";
                        }

                        adjustBounds();
                    } else {
                        statusEl.innerText = "Waiting for driver to start sharing location...";
                        speedContainer.style.display = "none";
                        if (busMarker) {
                            busMarker.setMap(null);
                            busMarker = null;
                        }
                    }
                } catch (err) {
                    console.error("Error polling live location:", err);
                }
            };

            pollInterval(); // Immediate call
            intervalId = setInterval(pollInterval, 3000); // poll every 3 seconds
        }

    } catch (err) {
        console.error("Failed to initialize tracking screen:", err);
        document.getElementById("trackingStatus").innerText = "Error loading map. Please check your configuration.";
    }

    const cleanup = () => {
        if (watchId) navigator.geolocation.clearWatch(watchId);
        if (intervalId) clearInterval(intervalId);
    };

    document.getElementById("trackingBackBtn")?.addEventListener("click", () => {
        cleanup();
        if (role === "driver") {
            showDriver();
        } else {
            showStudent();
        }
    });
}
