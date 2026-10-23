import { createResource, Match, Show, Switch } from "solid-js"
import { Button, Group, Notice, Row, Skeleton } from "./kit"
import { fetchStorage, formatSize, nearlyFull, OBJECT_LIMIT_BYTES, type Storage } from "./storage-client"

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
      class="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)]"
      data-part="storage-meter"
    >
      <div
        class="h-full rounded-full"
        classList={{
          "bg-[var(--error)]": nearlyFull(props.storage),
          "bg-[color-mix(in_oklab,var(--foreground)_45%,transparent)]": !nearlyFull(props.storage),
        }}
        style={{ width: `${(used() / OBJECT_LIMIT_BYTES) * 100}%` }}
      />
    </div>
  )
}

export function StorageGroup() {
  const [storage, { refetch }] = createResource(fetchStorage)
  return (
    <Group title="Storage" data-component="storage">
      <Switch>
        <Match when={storage.state === "errored"}>
          <Row label="Object storage" description="Kiko could not read how much is used.">
            <Button data-action="retry-storage" onClick={() => void refetch()}>
              Try again
            </Button>
          </Row>
        </Match>
        <Match when={storage()}>
          {(s) => (
            <>
              <Row
                label="Object storage"
                description={about(s())}
                details={
                  <div class="pt-1">
                    <Meter storage={s()} />
                  </div>
                }
              >
                <span class="text-md" data-field="object-bytes">
                  {formatSize(s().objectBytes)} of {formatSize(OBJECT_LIMIT_BYTES)}
                </span>
              </Row>
              <Show when={nearlyFull(s())}>
                <div class="px-4 py-2.5" data-part="storage-warning">
                  <Notice>
                    The object is nearly full. Turn on R2 in your Cloudflare account so Kiko can move history older than
                    30 days out of it.{" "}
                    <a class="underline underline-offset-2" href={R2_URL} target="_blank" rel="noreferrer">
                      About R2
                    </a>
                  </Notice>
                </div>
              </Show>
            </>
          )}
        </Match>
        <Match when={true}>
          <Row label="Object storage" description="Reading how much is used." data-part="storage-loading">
            <Skeleton class="h-5 w-24" />
          </Row>
        </Match>
      </Switch>
    </Group>
  )
}
