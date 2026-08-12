export function homeView(){
    return `
        <div class="home">
            <h2>Welcome</h2>
            <p>Select your role to continue to the dashboard.</p>

            <div class="role-grid">
                <button id="studentBtn" class="role-btn">
                    👨‍🎓 Student
                </button>

                <button id="driverBtn" class="role-btn">
                    🚍 Driver / Conductor
                </button>
            </div>
        </div>
    `;
}
