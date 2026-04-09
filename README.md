# Web-E-Vil

A collaborative pixel art canvas inspired by Reddit's r/place. Users join a shared digital canvas and place colored pixels to contribute to a collective piece of art.

## Current MVP Features
- Shared 1024x1024 pixel canvas
- Real-time updates across connected clients
- Pan and zoom controls on the canvas
- Paint and erase tools
- Brush sizes from 1 to 5
- Email/password authentication
- Login-required painting and erasing
- Per-user custom color palettes (plus default shared colors)
- Daily paint limit of 50 actions per user
- Full pixel edit history persisted in PostgreSQL

## Contributors
- Sami Yohannes (sayo4369)
- Samuel Lauer (sala1908)
- Denys Davydenko (s-ddavydenko)

## Technology Stack
- **Frontend:** Handlebars (HBS), CSS, JavaScript
- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL
- **Containerization:** Docker

## Prerequisites
- Docker Desktop installed
- Node.js (LTS version)
- Git

## How to Run Locally
1. Clone the repository:
   git clone https://github.com/sala1908/web-app-social-experiment.git

2. Navigate to the source code folder:
   cd web-app-social-experiment/ProjectSourceCode

3. Ensure the root `.env` file exists at `web-app-social-experiment/.env` with:
   POSTGRES_USER=postgres
   POSTGRES_PASSWORD=pwd
   POSTGRES_DB=users_db
   SESSION_SECRET=super-duper-secret

4. Start the application:
   docker compose -f docker_compose.yaml up --build

5. Open your browser and go to:
   http://localhost:3000

## How to Run Tests
1. Navigate to the ProjectSourceCode folder:
   cd ProjectSourceCode

2. Run the app stack for manual verification:
   docker compose -f docker_compose.yaml up --build

3. Manual smoke checks:
   - Register two users in two browser sessions
   - Verify both sessions see real-time pixel updates
   - Verify painting is rejected when not logged in
   - Verify per-user palette additions work
   - Verify the 51st paint in one day is rejected

## Deployed Application
Link coming soon

# Project-014-3
Repository for team 014-3's Software Development Methods and Tools Project
# Authors:
Samuel Lauer, Denys ..., Mac Finigan, Sami
# Summary: 
This application is intended to provide a social experiment experience to the users. With inspiration from projects like r/place, we aim to create an interactive enviornment where users can compare their scores with others, and compete. 