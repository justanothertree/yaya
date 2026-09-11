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

/**
 * One thread of the about block: a question somebody might actually ask, and the answer.
 *
 * ⚠️ QUESTIONS IN A VISITOR'S WORDS, not headings in mine. "Background" and "Experience" are
 * labels on a form; "What is all this?" is the thing somebody is actually thinking on the way
 * past. The block is explorable rather than a wall of prose because a stranger reads one answer
 * and leaves, and they should get to pick which one.
 *
 * ⚠️ ADDING ONE IS ONE OBJECT. That is the whole design: the threads here are only the ones
 * that could be written from what already exists — the Circuit's history, how the site is put
 * together, and what it is for. The ones about a PERSON (where I came from, what I am into, what
 * I have done before) are not here because nobody but Evan can write them, and a portfolio with
 * invented biography on it is worse than a short one. Add them here and they appear.
 */
export type AboutThread = {
  /** the question, as a visitor would put it */
  q: string
  /** the answer, one entry per paragraph */
  a: string[]
  /** where to go if this one landed */
  go?: { label: string; href: string; external?: boolean }
}

export const HOME: {
  hero: HomeText
  about: { heading: string; lede: string; threads: AboutThread[] }
} = {
  hero: {
    heading:
      'The internets number one Claude Maxer. Creating fun tools that anyone can use, together.',
    blurb:
      'Tools and toys my friends and family use every day. Everything here is live — press something.',
  },
  about: {
    heading: 'About me',
    lede: 'Pick whichever one you were going to ask.',
    threads: [
      {
        q: 'What is all this?',
        a: [
          'The Circuit started as a spreadsheet my friends and I used to score our workouts. Then a single HTML file. Now it’s the biggest thing on this site and they still use it daily.',
          'That’s how all of it goes — ideas I want to exist, built brick by brick. Nothing here is a demo of something else; every one of them is a thing somebody actually uses.',
        ],
      },
      {
        q: 'How did I get into this?',
        a: [
          'A spreadsheet. My friends and I wanted to score our workouts against each other, so I made one — then it became a single HTML file so it worked on a phone, then it needed accounts, then it needed to sync between us, and by then it was an app.',
          'Everything since has gone the same way. Nothing here started as a project; each one started as something I wanted to exist, built at the smallest size that worked, and it grew because people kept opening it.',
        ],
      },
      {
        q: 'What am I into?',
        a: [
          'Most of what I like ends up in here, so the list is the site: lifting and running, films on a Friday, music, drawing, and games.',
          'The thread through all of it is that it is shared. Almost nothing here is single player — the workout board is a league, the film ratings are an argument, the paint canvas takes two people at once, and the snake game has other people in it.',
        ],
      },
      {
        q: 'How is it built?',
        a: [
          'One React app. Every project runs inside it rather than linking out somewhere, so a game, a paint studio and a workout board share the same navigation, the same account and the same theme — and you can pop any of them into its own floating window.',
          'Supabase behind it, with who-can-see-what decided by the database rather than by the page asking nicely. The repository is public, so the security has to hold up when anybody can read exactly how it works.',
          'I work with AI the whole way through, so this site is also a record of what building that way is like.',
        ],
      },
      {
        q: 'Who is it for?',
        a: [
          'My friends and my family first — they are the ones in the Circuit every day and in the chat every evening.',
          'Which sets the bar for everything else: if somebody who does not care about software cannot open a page and work it out without me stood next to them, it is not finished.',
        ],
      },
    ],
  },
}
