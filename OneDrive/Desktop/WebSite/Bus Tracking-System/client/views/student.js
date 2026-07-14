export function studentView() {
    return `
        <div class="page">
            <h2>Student Dashboard</h2>
            <p>Kindly select your route and journey.</p>
            <br>
            <label for="route">Route</label><br>
            <select id="route" name="route" disabled>
                <option value="">Loading routes…</option>
            </select>
            <br><br>
            <label>Journey</label><br>
            <input type="radio" name="journey" value="Pickup" checked> Pickup
            <input type="radio" name="journey" value="Dropoff"> Dropoff
            <br><br>
            <button id="trackBtn" class="primary-btn">Track Bus</button>
            <button id="backBtn" class="secondary-btn">Back</button>
        </div>
    `; 
}
