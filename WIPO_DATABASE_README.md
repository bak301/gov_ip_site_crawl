# WIPO application database

The scraper now stores its durable, queryable data in `WIPO_Application_History.sqlite`.
The existing tab-separated tracking file remains unchanged for compatibility.

## Tables

- `applications`: the latest known values for each application number.
- `application_snapshots`: every distinct version observed, with first/last observation times and a count.
- `application_changes`: one row per changed field, including its old value, new value, timestamp, and source.

The application number (for example `VN-4-2025-08584` or `3-2025-01533`) is the stable key. A scraper ID is only used as a fallback when an application number is missing.

## Convert the historical tracking file

From this directory, run:

```powershell
npm run db:import
```

To select different paths:

```powershell
node import_tracking_to_sqlite.js --input "D:\path\tracking.txt" --db "D:\path\wipo.sqlite"
```

The import is safe to run again. It does not create duplicate current records,
snapshots, observation counts, or change rows.

## Example queries

```sql
-- Current data for one application
SELECT *
FROM applications
WHERE application_number = 'VN-4-2025-08584';

-- Field-by-field change history
SELECT changed_at, field_name, old_value, new_value, source
FROM application_changes
WHERE application_number = 'VN-4-2025-08584'
ORDER BY changed_at, id;

-- Complete distinct versions
SELECT first_observed_at, last_observed_at, seen_count, data_json
FROM application_snapshots
WHERE application_number = 'VN-4-2025-08584'
ORDER BY first_observed_at;
```
