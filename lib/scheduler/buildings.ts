export type BuildingInfo = {
  /** Human-friendly building/area name shown in UI controls. */
  name: string;
  /** Latitude/longitude for map marker placement. */
  coords: [number, number];
};

/**
 * Canonical list of Cypress College building codes used across the app.
 * Keeping this in one place avoids data drift between calendar and map views.
 */
export const BUILDINGS: Record<string, BuildingInfo> = {
  BBF: { name: 'Baseball Field', coords: [33.828350865002704, -118.02147325915115] },
  BK: { name: 'Book Store', coords: [33.82782899995476, -118.0256343519516] },
  BUS: { name: 'Business', coords: [33.82764291754249, -118.0261296107725] },
  CCCPLX: { name: 'Cypress College Complex', coords: [33.828293535988884, -118.02536342312762] },
  '1VPA': { name: 'Fine Arts', coords: [33.82908674904778, -118.02565754198164] },
  FASS: { name: 'Fine Arts Swing Space', coords: [33.82917971324042, -118.02440299254006] },
  G1: { name: 'Gym 1', coords: [33.82768633899941, -118.02395356454173] },
  G2: { name: 'Gym 2', coords: [33.82721511092138, -118.0237862842233] },
  HUM: { name: 'Humanities', coords: [33.82967948582821, -118.024962491319] },
  'H/HUM': { name: 'Humanities Lecture Hall', coords: [33.829451459956246, -118.0249256405959] },
  'L/LRC': { name: 'Library/Learning Resource Center', coords: [33.82832918616391, -118.02344296146632] },
  'M&O': { name: 'Maintenance & Operations', coords: [33.829522087373014, -118.02246364926803] },
  POOL: { name: 'Pool', coords: [33.82726389489849, -118.02461708360693] },
  SBF: { name: 'Softball Field', coords: [33.827470151893166, -118.02117746689576] },
  SLL: { name: 'Student Life & Leadership', coords: [33.82762283109881, -118.02462661611317] },
  SC: { name: 'Student Center', coords: [33.82776747253072, -118.02515590947029] },
  SEM: { name: 'Science Engineering Math', coords: [33.829171069830466, -118.02343240575921] },
  SOCCER: { name: 'Soccer Field', coords: [33.827048368931024, -118.02028619699738] },
  TA: { name: 'Theater Arts', coords: [33.82859367670119, -118.02637857202797] },
  TC: { name: 'Tennis Courts', coords: [33.82512279191629, -118.02178829093837] },
  TE1: { name: 'Tech Ed 1', coords: [33.82734880071696, -118.02545998266356] },
  TE2: { name: 'Tech Ed 2', coords: [33.826992294130825, -118.02464459111573] },
  TE3: { name: 'Tech Ed 3', coords: [33.82670708779164, -118.02519176175967] },
  TRACK: { name: 'Track & Field', coords: [33.82573114547679, -118.02066786365502] },
  VRC: { name: 'Veterans Resource Center', coords: [33.827857963876035, -118.02452054448868] },
  NOCE: { name: 'NOCE/ESL Classes', coords: [33.82634940282063, -118.02434729307518] },
  LOT1: { name: 'Parking Lot 1', coords: [33.82738481008401, -118.02689536777606] },
  LOT2: { name: 'Parking Lot 2', coords: [33.826486612497945, -118.02572211276656] },
  LOT3: { name: 'Parking Lot 3', coords: [33.82616303595734, -118.02538501865827] },
  LOT4: { name: 'Parking Lot 4', coords: [33.825258006809676, -118.0234983202711] },
  LOT5: { name: 'Parking Lot 5', coords: [33.82679243692882, -118.02253763919792] },
  LOT6: { name: 'Parking Lot 6', coords: [33.829613282480025, -118.02095236932291] },
  LOT7: { name: 'Parking Lot 7', coords: [33.82876971657518, -118.02238359248902] },
  LOT8: { name: 'Parking Lot 8', coords: [33.8295000526514, -118.02588668153949] },
};
