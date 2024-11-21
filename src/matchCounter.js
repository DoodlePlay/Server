function matchCounter(word1, word2) {
  const countChars = word => {
    if (typeof word === null) {
      word = ''; // currentWord가 null로 초기화 되었을 경우 에러 처리
    }

    const counts = {};
    for (const char of word) {
      counts[char] = (counts[char] || 0) + 1;
    }
    return counts;
  };

  const counts1 = countChars(word1);
  const counts2 = countChars(word2);

  let matches = 0;
  for (const char in counts1) {
    if (counts2[char]) {
      matches += Math.min(counts1[char], counts2[char]);
    }
  }

  return matches;
}
export default matchCounter;
