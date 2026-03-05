import type { CheckedClaim, QuestionAnswer } from './types.ts';

const now = Date.now();
const min = 60_000;

export const mockClaims: CheckedClaim[] = [
  {
    id: '1',
    claim: 'Einstein failed math in school',
    speaker: 'Alex',
    context: '"Einstein actually failed math as a kid"',
    verification: {
      verdict: 'FALSE',
      confidence: 0.95,
      explanation: 'Einstein excelled at mathematics throughout his education. He mastered calculus by age 15 and scored top marks in math at the Zurich Polytechnic. This myth likely originated from a misunderstanding of the Swiss grading system.',
      correction: 'Einstein was exceptional at math from a young age.',
      sources: [
        { title: 'Einstein biography — American Museum of Natural History', url: 'https://www.amnh.org/exhibitions/einstein' },
        { title: 'Snopes: Einstein Flunked Math?', url: 'https://www.snopes.com/fact-check/einstein-failed-mathematics/' },
      ],
    },
    timestamp: now - 2 * min,
  },
  {
    id: '2',
    claim: 'The Great Wall of China is visible from space',
    speaker: 'Sam',
    context: '"You can see the Great Wall from space"',
    verification: {
      verdict: 'FALSE',
      confidence: 0.92,
      explanation: 'Multiple astronauts have confirmed the Great Wall is not visible from low Earth orbit with the naked eye. It is long but only about 6 meters wide — far too narrow to resolve from orbital altitude.',
      correction: 'The Great Wall is not visible from space without aid.',
      sources: [
        { title: 'NASA: Is the Great Wall Visible from Space?', url: 'https://www.nasa.gov/vision/space/workinginspace/great_wall.html' },
        { title: 'Scientific American', url: 'https://www.scientificamerican.com/article/is-chinas-great-wall-visible-from-space/' },
      ],
    },
    timestamp: now - 5 * min,
  },
  {
    id: '3',
    claim: 'Napoleon was unusually short',
    speaker: 'Sam',
    context: '"Napoleon had a complex because he was so short"',
    verification: {
      verdict: 'MOSTLY_FALSE',
      confidence: 0.9,
      explanation: 'Napoleon was approximately 5\'7" (170 cm), average or slightly above average for French men of his era. The myth stems from British propaganda and confusion between French and English inches.',
      correction: 'Napoleon was average height for his time — about 5\'7".',
      sources: [
        { title: 'History.com: Was Napoleon Short?', url: 'https://www.history.com/news/napoleon-complex-short' },
        { title: 'BBC: How tall was Napoleon?', url: 'https://www.bbc.com/news/magazine-21142700' },
      ],
    },
    timestamp: now - 8 * min,
  },
  {
    id: '4',
    claim: 'The Amazon produces 20% of the world\'s oxygen',
    speaker: 'Alex',
    context: '"The Amazon is the lungs of the Earth, 20% of our oxygen"',
    verification: {
      verdict: 'FALSE',
      confidence: 0.88,
      explanation: 'The Amazon consumes roughly as much oxygen as it produces through decomposition. The 20% figure is a common myth. Most of Earth\'s oxygen comes from ocean phytoplankton.',
      correction: 'The Amazon\'s net oxygen contribution is near zero. Oceans produce most oxygen.',
      sources: [
        { title: 'National Geographic', url: 'https://www.nationalgeographic.com/environment/article/why-amazon-doesnt-produce-20-percent-worlds-oxygen' },
        { title: 'Yale Environment 360', url: 'https://e360.yale.edu/digest/why-the-amazon-doesnt-really-produce-20-percent-of-the-worlds-oxygen' },
      ],
    },
    timestamp: now - 12 * min,
  },
];

export const mockAnswer: QuestionAnswer = {
  id: 'q1',
  question: 'How many moons does Jupiter have?',
  answer: 'As of 2024, Jupiter has 95 confirmed moons. The four largest — Io, Europa, Ganymede, and Callisto — are the Galilean moons.',
  confidence: 0.93,
  sources: ['NASA Solar System Exploration', 'International Astronomical Union'],
  caveats: 'New moons are still being discovered.',
  timestamp: now - 1 * min,
};
