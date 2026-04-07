# User Acceptance Testing

This is the last phase of the software testing process. During UAT, actual users test the software to make sure it can handle the required tasks in real-world scenarios, according to the specifications.
Below are some sample test cases for UAT testing:

-    User should be able to log in with correct credentials.
-    User authentication fails when the user provides invalid credentials.
-    The form provides the user with specific feedback about the error.

Acceptance Criteria:
Acceptance criteria refers to a set of predefined requirements that must be met in order to mark a user story as complete. Below is an example:
A user cannot submit a form without completing all of the mandatory fields. Mandatory fields include:

-    Name
-    Email Address
-    Password
-    Confirm Password

Information from the form is stored in the `users` table in the PostgreSQL database configured by `POSTGRES_DB`.

## Test 1:
Test every color palette for every type of user (guest, user, admin). This test depends on how color picking is implemented.
Run either item 1 or item 2 below, depending on which palette implementation is active.

	1. **Individual User Color Palette:**
	   Validate that users can paint with colors available in their combined palette (`default_palette` plus their `user_palette`).

	   **Endpoints and DB interaction**
	   - `GET /api/palette` returns allowed colors for the authenticated user from `default_palette` and `user_palette`.
	   - `POST /api/paint` with payload `{ x, y, brushSize, mode, color }` is used to apply paint.
	   - On successful paint request:
	     - API validates `color` against allowed colors from `default_palette` + `user_palette`.
	     - API inserts one row into `paint_actions` for the user.
	     - API upserts affected cells in `canvas_pixels` and records one row per modified cell in `pixel_history`.
	   - On failed paint request (color not in allowed palette):
	     - API returns `403 Forbidden` with message `Color is not in your allowed palette.`
	     - No new rows are inserted into `paint_actions` or `pixel_history`.

	   **Test steps**
	   1. Create/identify a test user and ensure the account has known colors available in `user_palette` (in addition to `default_palette`).
	   2. Call `GET /api/palette`; store returned allowed colors.
	   3. For each allowed color, call `POST /api/paint` and verify `200 OK`.
	   4. After each success, verify in DB that affected cells in `canvas_pixels` were updated to the submitted `color`.
	   5. Verify `pixel_history` contains one row per modified cell (with `action = 'paint'`) and `paint_actions` contains one row per paint request.
	   6. Submit one disallowed color via `POST /api/paint`; verify `403 Forbidden`.
	   7. Re-check DB to confirm no new `paint_actions` or `pixel_history` rows were created for the rejected request.
	   8. Add or remove a user-specific color in `user_palette`, then repeat steps 2-7 to confirm API behavior follows DB changes.

	Acceptance Criteria:
	- User can paint with colors present in `default_palette` and that user's `user_palette`.
	- User cannot paint with colors that are not present in the allowed palette tables.
	- Successful requests persist color updates in `canvas_pixels`.
	- Successful requests create records in `paint_actions` and `pixel_history`.
	- Rejected requests do not create new `paint_actions` or `pixel_history` records.


	2. **Level Based Color Palette:**
	Validate that when level-based palette rules are enabled, users can use all colors unlocked at their current level and all previous levels, but not colors from higher levels.

		**Assumptions and DB interaction**
		- Level progression is managed by application logic (or a separate service), while paint and palette effects still use existing tables.
		- `GET /api/palette` returns the currently allowed color set for the authenticated user.
		- `POST /api/paint` enforces palette rules and writes successful actions to `paint_actions`, `canvas_pixels`, and `pixel_history`.
		- Rejected out-of-level color attempts return `403 Forbidden` and do not write new paint records.

		**Test steps**
		1. Prepare a test user at Level N and determine expected allowed colors for Level N.
		2. Call `GET /api/palette` and verify response matches expected colors for Level N.
		3. Submit `POST /api/paint` requests for each allowed color and verify `200 OK`.
		4. Verify DB updates for successful paints:
			- One row per request in `paint_actions`.
			- Updated cells in `canvas_pixels`.
			- One row per modified cell in `pixel_history`.
		5. Submit one color that belongs only to Level N+1 and verify `403 Forbidden`.
		6. Verify no new rows were added for the rejected request in `paint_actions` and `pixel_history`.
		7. Increase the user from Level N to Level N+1 through the system's normal progression flow.
		8. Repeat steps 2-6 and confirm newly unlocked colors are now accepted while still retaining older unlocked colors.

		Acceptance Criteria:
		- A Level N user can paint only with colors unlocked up to Level N.
		- After leveling up, newly unlocked colors are accepted.
		- Previously unlocked colors remain accepted.
		- Rejected color attempts create no new rows in `paint_actions` or `pixel_history`.

## Test 2:
Daily Paint Limit Enforcement
Validate that regular users cannot exceed the configured daily paint cap and that limit values are consistently reflected in the API.

**Endpoints and DB interaction**
- `GET /api/me/limits` returns current paint limits for authenticated users.
- `POST /api/paint` consumes one daily action for regular users by inserting into `paint_actions`.
- When limit is reached, `POST /api/paint` returns `429` and no new rows are added to `paint_actions` or `pixel_history`.
- `paint_actions.created_at` is used to calculate per-day usage in UTC.

**Test steps**
1. Log in as a regular (non-admin) user with a valid palette color.
2. Call `GET /api/me/limits` and record `dailyMaxPaints` and `remainingPaints`.
3. Send repeated `POST /api/paint` requests with valid coordinates and allowed color until `remainingPaints` reaches 0.
4. After each successful request, verify:
   - Response is `200 OK`.
   - `remainingPaints` decreases by 1.
   - One new row is added in `paint_actions`.
5. Send one additional `POST /api/paint` request after the limit is reached.
6. Verify this request returns `429` with `Daily paint limit reached.`
7. Verify no additional rows were added to `paint_actions` or `pixel_history` for the rejected request.
8. Call `GET /api/me/limits` again and verify `remainingPaints` remains 0.

Acceptance Criteria:
- Regular users can paint only until their daily limit is exhausted.
- API returns accurate limit information via `GET /api/me/limits`.
- Over-limit paint attempts return `429`.
- Over-limit attempts do not create additional `paint_actions` or `pixel_history` rows.

## Test 3:
Admin Controls and Safety
Validate that admin-only reset endpoints are protected, execute correctly for admins, and preserve expected system behavior.

**Endpoints and DB interaction**
- `POST /api/admin/reset-canvas` requires admin privileges and deletes all rows from `canvas_pixels`.
- `POST /api/admin/reset-daily-limit` requires admin privileges and deletes today's rows from `paint_actions`.
- Non-admin access to these endpoints must return `403 Forbidden`.
- After reset operations, normal paint flow through `POST /api/paint` should continue to work.

**Test steps**
1. Log in as a regular user and attempt `POST /api/admin/reset-canvas` and `POST /api/admin/reset-daily-limit`.
2. Verify both calls return `403 Forbidden` and no admin reset changes occur in DB.
3. Log in as admin and call `POST /api/admin/reset-canvas`.
4. Verify response is `200 OK` and `canvas_pixels` is empty.
5. As admin, call `POST /api/admin/reset-daily-limit`.
6. Verify response is `200 OK` and today's entries in `paint_actions` are removed.
7. Log in as a regular user and perform a normal `POST /api/paint` request.
8. Verify paint succeeds (`200 OK`) and new records are created as expected (`paint_actions`, `canvas_pixels`, `pixel_history`).

Acceptance Criteria:
- Non-admin users cannot execute admin reset endpoints (`403 Forbidden`).
- Admin users can execute reset endpoints successfully.
- `reset-canvas` clears `canvas_pixels`.
- `reset-daily-limit` clears today's `paint_actions` entries.
- Regular painting still works correctly after admin reset operations.
