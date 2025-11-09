declare module 'bad-words' {
  export class Filter {
    constructor(options?: {
      placeHolder?: string
      emptyList?: boolean
      list?: string[]
      regex?: RegExp
    })
    clean(input: string): string
    addWords(...words: string[]): void
    removeWords(...words: string[]): void
    isProfane(input: string): boolean
  }
}
