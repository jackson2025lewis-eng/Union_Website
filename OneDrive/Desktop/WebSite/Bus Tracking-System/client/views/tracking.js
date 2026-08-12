export function trackingView(role) {
    return `
        <div class="page" style="width: min(100%, 700px);">
            <h2>${role === "driver" ? "Driver Sharing Mode" : "Real-Time Bus Tracker"}</h2>
            <p id="trackingStatus">Initializing...</p>
            
            <div id="map" style="height: 400px; border-radius: 12px; border: 1px solid #dbe4f0; margin: 18px 0; background: #f8fbff; z-index: 1;"></div>

            <div class="info-panel" style="background: #f8fbff; padding: 14px; border-radius: 10px; border: 1px solid #e2e8f0; margin-bottom: 18px; font-size: 0.95rem; line-height: 1.6;">
                <p><strong>Route:</strong> <span id="infoRoute">Loading...</span></p>
                <p><strong>Selected Stop:</strong> <span id="infoStop">Loading...</span></p>
                <p><strong>Journey:</strong> <span id="infoJourney">Loading...</span></p>
                <p id="speedContainer" style="display: none;"><strong>Speed:</strong> <span id="infoSpeed">0 km/h</span></p>
            </div>

            <div style="display: flex; gap: 10px;">
                ${role === "driver" ? `<button id="stopSharingBtn" class="primary-btn" style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); box-shadow: 0 8px 18px rgba(239, 68, 68, 0.2);">Stop Sharing</button>` : ''}
                <button id="trackingBackBtn" class="secondary-btn">Back</button>
            </div>
            
            ${role === "driver" ? `
            <div style="margin-top: 14px; font-size: 0.85rem; color: #64748b; background: #fffbeb; border: 1px solid #fef3c7; padding: 8px; border-radius: 6px;">
                💡 <strong>Dev Tip:</strong> Geolocation requires HTTPS or localhost. If it fails, a simulated GPS route path will be shared automatically.
            </div>` : ''}
        </div>
    `;
}
