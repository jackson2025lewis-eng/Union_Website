export function driverView() {
    return `
        <div class="page">
            <h2>Driver Dashboard</h2>
            <p>Kindly share your location.</p>
            <br>
            <label for="driverRoute">Route</label><br>
            <select id="driverRoute" name="route" disabled>
                <option value="">Loading routes…</option>
            </select>
            <br><br>
            <label>Journey</label><br>
            <input type="radio" name="driverJourney" value="Pickup" checked> Pickup
            <input type="radio" name="driverJourney" value="Dropoff"> Dropoff
            <br><br>
            <button id="shareBtn" class="primary-btn">Start Sharing</button>
            <button id="backBtn" class="secondary-btn">Back</button>
        </div>
    `;
}
