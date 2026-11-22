/**
 * Where the pips sit on a die face or half a domino, 0 to 6, as places on a three-by-three read
 * row by row (0 top left, 4 the middle, 8 bottom right). Dice, Liar's dice, Shut the box and Yacht
 * each had their own copy of this table and Dominoes its own with a blank; this is the one.
 */
export const PIPS: readonly (readonly number[])[] = [
  [],
  [4],
  [0, 8],
  [0, 4, 8],
  [0, 2, 6, 8],
  [0, 2, 4, 6, 8],
  [0, 2, 3, 5, 6, 8],
]
