/** A route with nothing built yet. Says so instead of pretending. */
export function Placeholder(props: { name: string }) {
  return (
    <div
      class="grid min-h-0 flex-1 place-items-center text-sm text-weak"
      data-component="route-placeholder"
      data-route={props.name}
    >
      {props.name} is not built yet
    </div>
  )
}
