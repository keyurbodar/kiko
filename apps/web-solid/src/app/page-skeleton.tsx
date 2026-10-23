export function PageSkeleton() {
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3 p-6" data-component="page-skeleton" aria-hidden="true">
      <span class="motion-skeleton h-6 w-40 rounded-md" />
      <span class="motion-skeleton h-4 w-64 rounded-md" />
      <span class="motion-skeleton mt-2 h-24 w-full rounded-lg" />
      <span class="motion-skeleton h-4 w-3/4 rounded-md" />
    </div>
  )
}
