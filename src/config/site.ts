export const site = {
  name: 'Evan Cook',
  /** The browser-tab title for the home page. ⚠️ Mirrors <title> in index.html — that one is
   *  what search engines and a cold load see, this one is what the app restores when you
   *  navigate back to home. Change both together. */
  title: 'Evan Cook — tools and toys my friends and family use every day',
  url: 'https://evancook.dev/',
  domain: 'evancook.dev',
  /**
   * Who runs the family fund, in the words a member reads.
   *
   * ⚠️ A FIRST NAME, AND A SETTING RATHER THAN A LITERAL. The Investments card speaks to
   * children about money somebody else is putting in for them — "ask Evan to set one up",
   * "Evan catches that up" — and a surname there reads like a bank. It is here rather than
   * typed into the card so another family changes one line, which is the same reason
   * `_fund_timeline` takes the fund size from the data instead of hard-coding 33.
   */
  fundOwner: 'Evan',
  socials: {
    github: 'https://github.com/justanothertree',
    linkedin: 'https://www.linkedin.com/in/evan-cook-72686a2ab',
  },
}
