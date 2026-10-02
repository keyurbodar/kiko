-- Account deletion (P9-02). One row per deleted user id, kept for good. Better Auth's
-- cookie cache can vouch for a session for five minutes after its row is gone, so
-- getSessionUser checks this table on every request.
create table "deleted_user" ("id" text not null primary key, "deletedAt" integer not null);
