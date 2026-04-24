# Web-E-Vil

Web-E-Vil is a collaborative pixel art canvas inspired by Reddit's r/place. The application lets authenticated users contribute pixels to a shared board in real time, while preserving edit history and enforcing per-user limits.

## Overview

This project is a social drawing experiment built as a full-stack web application. It combines real-time collaboration, session-based authentication, and persistent state backed by PostgreSQL.

## Features

- Shared 1024x1024 pixel canvas
- Real-time canvas updates across connected clients
- Pan and zoom controls for navigation
- Paint and erase tools with brush sizes from 1 to 5
- Email and password authentication
- Login required for painting and erasing
- Starter palette plus unlockable palette store swatches
- XP and level progression from painting, with level-up palette tokens
- Daily paint limits that scale with level (base 100 at level 0, growth by level)
- Full pixel edit history stored in PostgreSQL
- Social interactions on canvas groups (like, dislike, report, friend, name, remove)
- Protected space around user groups to prevent unauthorized overwrite
- Admin controls for reset, moderation, and user progression management

## Technology Stack

| Layer | Technology |
| --- | --- |
| Frontend | Handlebars 8.0.1, JavaScript, CSS |
| Backend | Node.js 20, Express 4.21.2 |
| Real-time | Socket.IO 4.8.1 |
| Authentication | express-session 1.18.1, bcryptjs 2.4.3, connect-pg-simple 10.0.0 |
| Database | PostgreSQL (Docker official image) |
| Security and logging | helmet 8.1.0, morgan 1.10.0 |
| Configuration | dotenv 16.4.5 |
| Containerization | Docker, Docker Compose |

## Repository Structure

- [ProjectSourceCode/](ProjectSourceCode/) contains the application source code, Docker files, and views
- [MilestoneSubmissions/](MilestoneSubmissions/) contains milestone planning and release notes
- [TeamMeetingLogs/](TeamMeetingLogs/) contains meeting notes

## Prerequisites

- Docker Desktop
- Git

## Local Setup

1. Clone the repository.

   ```bash
   git clone https://github.com/sala1908/web-app-social-experiment.git
   cd web-app-social-experiment/ProjectSourceCode
   ```

2. Create a root `.env` file at `web-app-social-experiment/.env` with the required database and session values.

   ```env
   POSTGRES_USER=postgres
   POSTGRES_PASSWORD=postgres
   POSTGRES_DB=web_e_vil
   DB_HOST=db
   DB_PORT=5432
   PORT=3000
   SESSION_SECRET=change-this-secret
   ADMIN_PASSWORD=change-this-admin-password
   ```

3. Start the application.

   ```bash
   docker compose -f docker-compose.yaml up --build
   ```

4. Open the app in your browser.

   ```text
   http://localhost:3000
   ```

## Deployment

Deployed link:
(https://web-app-social-experiment.onrender.com/)

## Verification

The project includes an automated Mocha/Chai test suite in `ProjectSourceCode/test/server.spec.js`.

Run:

```bash
cd ProjectSourceCode
npm test
```

For additional manual verification, run the application and confirm the following:

- Two browser sessions can register and log in successfully
- Real-time pixel updates appear in both sessions
- Anonymous users cannot paint or erase
- Palette selection and unlock state are persisted per user
- Daily paint limit responses from `/api/me/limits` change based on user level

## Runtime Scripts

The application scripts defined in `ProjectSourceCode/package.json` are:

- `npm start` to run the production server
- `npm run dev` to run the server with nodemon
- `npm run init-db` to initialize the database schema
- `npm test` to run automated tests

## Contributors

- Sami Yohannes
- Samuel Lauer
- Denys Davydenko
- Macallan Finigan

## Project Context

This repository was developed as part of a Software Development Methods and Tools project focused on building a real-time social collaboration experience.