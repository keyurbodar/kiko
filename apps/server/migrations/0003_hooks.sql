-- Architecture section 25.4. A webhook routine's URL carries a token. The Worker finds the user and
-- the routine from the token's SHA-256, never from the request, so it can build the object name
-- without a session (DEVIATION D9). Only UserDO writes these rows, when a webhook routine is made,
-- and deletes them when it is cancelled.
create table "hooks" ("token_hash" text not null primary key, "user_id" text not null, "routine_id" text not null, "created_at" integer not null);
create index "hooks_routine" on "hooks" ("routine_id");
