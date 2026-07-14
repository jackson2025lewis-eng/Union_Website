const API_URL = (window.location.origin === "null" || window.location.port === "5500")
    ? "http://localhost:3000"
    : window.location.origin;

export async function loadGoogleMaps() {
    if (window.google && window.google.maps) {
        return window.google.maps;
    }

    let apiKey = "";
    try {
        const response = await fetch(`${API_URL}/config`);
        if (response.ok) {
            const config = await response.json();
            apiKey = config.googleMapsApiKey || "";
        }
    } catch (err) {
        console.warn("Failed to fetch Google Maps API key from backend config:", err);
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?v=weekly${apiKey ? `&key=${apiKey}` : ""}`;
        script.async = true;
        script.defer = true;
        script.onload = () => {
            if (window.google && window.google.maps) {
                resolve(window.google.maps);
            } else {
                reject(new Error("Google Maps JavaScript API loaded but window.google.maps is undefined."));
            }
        };
        script.onerror = (err) => reject(err);
        document.head.appendChild(script);
    });
}
