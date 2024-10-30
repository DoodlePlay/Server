function drawerScoreCalculator(userCount, correctAnswerCount) {
  if (userCount === 2) {
    if (correctAnswerCount === 0) return 10;
  }
  if (userCount === 3) {
    if (correctAnswerCount === 0) return 10;
    if (correctAnswerCount === 1) return -10;
  }
  if (userCount === 4) {
    if (correctAnswerCount === 0) return 10;
    if (correctAnswerCount === 1) return 0;
    if (correctAnswerCount === 2) return -10;
  }
  if (userCount === 5) {
    if (correctAnswerCount === 0) return 5;
    if (correctAnswerCount === 1) return 5;
    if (correctAnswerCount === 2) return -5;
    if (correctAnswerCount === 3) return -5;
  }
  if (userCount === 6) {
    if (correctAnswerCount === 0) return 5;
    if (correctAnswerCount === 1) return 5;
    if (correctAnswerCount === 2) return 0;
    if (correctAnswerCount === 3) return -5;
    if (correctAnswerCount === 4) return -5;
  }
}
export default drawerScoreCalculator;
