export type CodeEdges = {
  readonly top: boolean
  readonly bottom: boolean
  readonly left: boolean
  readonly right: boolean
}

export type ScrollBox = {
  readonly scrollTop: number
  readonly scrollHeight: number
  readonly clientHeight: number
  readonly scrollLeft: number
  readonly scrollWidth: number
  readonly clientWidth: number
}

export function codeEdges(box: ScrollBox): CodeEdges {
  return {
    top: box.scrollTop > 0,
    bottom: box.scrollTop + box.clientHeight < box.scrollHeight - 1,
    left: box.scrollLeft > 0,
    right: box.scrollLeft + box.clientWidth < box.scrollWidth - 1,
  }
}

export function fadeInsets(element: HTMLElement): { bottom: number; right: number } {
  return {
    bottom: element.offsetHeight - element.clientHeight,
    right: element.offsetWidth - element.clientWidth,
  }
}
