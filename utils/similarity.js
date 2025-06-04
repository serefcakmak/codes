// utils/similarity.js
function rbfSimilarity(vecA, vecB, sigma = 1.0) {
  let sumSq = 0;
  for (let i = 0; i < vecA.length; i++) {
    let diff = vecA[i] - vecB[i];
    sumSq += diff * diff;
  }
  return Math.exp(-sumSq / (2 * sigma * sigma));
}

module.exports = { rbfSimilarity };
