import { Match, Show, Switch } from "solid-js"
import { Button, Group, Notice, Row, Skeleton } from "./kit"
import { createQuery, owner } from "../state/runtime"
import { formatSize, nearlyFull, OBJECT_LIMIT_BYTES, type Storage } from "./storage-client"

const R2_URL = "https://developers.cloudflare.com/r2/pricing/"

const about = (s: Storage) =>
  s.archiveEnabled
    ? "Chats and agent history. History older than 30 days moves to R2."
    : "Chats and agent history. R2 is not turned on, so all of it stays here."

function Meter(props: { storage: Storage }) {
  const used = () => Math.min(props.storage.objectBytes, OBJECT_LIMIT_BYTES)
  return (
    <div
      role="meter"
      aria-label="Object storage used"
      aria-valuemin={0}
      aria-valuemax={OBJECT_LIMIT_BYTES}
      aria-valuenow={used()}
      aria-valuetext={`${formatSize(props.storage.objectBytes)} of ${formatSize(OBJECT_LIMIT_BYTES)}`}
      class="h-1 overflow-hidden rounded-full bg-[var(--fill-control)]"
      data-part="storage-meter"
    >
      <div
        class="h-full rounded-full"
        classList={{
          "bg-[var(--danger)]": nearlyFull(props.storage),
          "bg-fg2": !nearlyFull(props.storage),
        }}
        style={{ width: `${(used() / OBJECT_LIMIT_BYTES) * 100}%` }}
      />
    </div>
  )
}

export function StorageGroup() {
  const storage = createQuery(() => owner.queries.storageUsage(undefined))
  return (
    <Group title="Storage" data-component="storage">
      <Switch>
        <Match when={storage.error}>
          <Row label="Storage" description="Kiko could not read how much is used.">
            <Button data-action="retry-storage" onClick={() => storage.refetch()}>
              Try again
            </Button>
          </Row>
        </Match>
        <Match when={storage()}>
          {(s) => (
            <div class="flex flex-col gap-2.5 px-4 py-3.5" data-setting="object-storage">
              <div class="flex items-baseline gap-1.5">
                <span class="type-row text-fg" data-field="object-bytes">
                  {formatSize(s().objectBytes)}
                </span>
                <span class="type-label text-[var(--fg3)]">of {formatSize(OBJECT_LIMIT_BYTES)}</span>
                <span class="ml-auto truncate type-label text-[var(--fg3)]">Stored in your Worker</span>
              </div>
              <Meter storage={s()} />
              <span class="type-label text-[var(--fg3)]">{about(s())}</span>
              <Show when={nearlyFull(s())}>
                <div data-part="storage-warning">
                  <Notice>
                    The object is nearly full. Turn on R2 in your Cloudflare account so Kiko can move history older than
                    30 days out of it.{" "}
                    <a class="link-grow" href={R2_URL} target="_blank" rel="noreferrer">
                      About R2
                    </a>
                  </Notice>
                </div>
              </Show>
            </div>
          )}
        </Match>
        <Match when={true}>
          <div class="flex flex-col gap-2.5 px-4 py-3.5" data-part="storage-loading">
            <Skeleton class="h-5 w-28" />
            <Skeleton class="h-1 w-full" />
          </div>
        </Match>
      </Switch>
    </Group>
  )
}
