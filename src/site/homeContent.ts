/**
 * What the home page says.
 *
 * ⚠️ THIS FILE IS THE ONLY COPY, and that is the point of it.
 *
 * The text used to be a document in the database, edited in the browser, with constants here as
 * the fallback while the fetch was in flight. Two sources of truth for one page, and it showed:
 * every visitor got the repo's wording first and then watched it change under them when the round
 * trip finished. The two were kept identical by hand to hide that, which is not a fix — it is a
 * chore that only works until somebody forgets.
 *
 * So the editor is gone and this is the page. A front door that changes a few times a year does
 * not need a CMS, and the one it had cost a request on first paint, a flash of the wrong copy, and
 * a class of bug where the repo and the live site quietly disagreed. Editing this file and pushing
 * is the publish step.
 *
 * (The site_content row and its save_site_content rpc are still in the database, unused and
 * harmless. Nothing reads them now.)
 */

export type HomeText = { heading: string; blurb: string }

export const HOME: {
  hero: HomeText
  about: { heading: string; paragraphs: string[] }
} = {
  hero: {
    heading:
      'The internets number one Claude Maxer. Creating fun tools that anyone can use, together.',
    blurb:
      'Real time calls with streaming. A workout tracker my friends use every day. A data driven investment tracker for my family. Games I want to exist. A digital audio workspace and music player with reactive visuals. A paint studio. Personalized profile pages. Customized website themes. It all runs here, and I build it with AI.',
  },
  about: {
    heading: 'About',
    paragraphs: [
      'The Circuit started as a spreadsheet my friends and I used to score our workouts. Then a single HTML file. Now it’s the biggest thing on this site and they still use it daily.',
      'That’s how all of it goes — ideas that I want to exist as my own, built together brick by brick. I work with AI the whole way through, so this site is also a record of what building that way is like. Still prototyping. Always adding.',
    ],
  },
}
