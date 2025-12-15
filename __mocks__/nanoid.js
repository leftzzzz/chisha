// Mock nanoid for Jest tests
let counter = 0;

module.exports = {
  nanoid: (size = 21) => {
    counter++;
    return `mock-nanoid-${counter}-${'x'.repeat(Math.max(0, size - 15))}`;
  },
};
