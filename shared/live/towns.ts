// Towns used for storm-track ETAs in the Philadelphia / NWS Mount Holly area.
export interface Town {
  name: string;
  state: string;
  lat: number;
  lon: number;
}

const t = (name: string, state: string, lat: number, lon: number): Town => ({ name, state, lat, lon });

export const TOWNS: Town[] = [
  t("Philadelphia", "PA", 39.9526, -75.1652), t("Norristown", "PA", 40.1215, -75.3399), t("King of Prussia", "PA", 40.1013, -75.3836),
  t("Doylestown", "PA", 40.3101, -75.1299), t("Levittown", "PA", 40.1551, -74.8288), t("Bristol", "PA", 40.1007, -74.8518),
  t("Lansdale", "PA", 40.2415, -75.2835), t("Pottstown", "PA", 40.2454, -75.6496), t("Phoenixville", "PA", 40.1304, -75.5149),
  t("West Chester", "PA", 39.9607, -75.6055), t("Media", "PA", 39.9168, -75.3877), t("Chester", "PA", 39.8496, -75.3557),
  t("Upper Darby", "PA", 39.9576, -75.2602), t("Reading", "PA", 40.3356, -75.9269), t("Allentown", "PA", 40.6084, -75.4902),
  t("Bethlehem", "PA", 40.6259, -75.3705), t("Easton", "PA", 40.6884, -75.2207), t("Quakertown", "PA", 40.4412, -75.3416),
  t("Coatesville", "PA", 39.9832, -75.8238), t("Downingtown", "PA", 40.0065, -75.7033), t("Exton", "PA", 40.029, -75.6212),
  t("Langhorne", "PA", 40.1745, -74.9227), t("Newtown", "PA", 40.229, -74.9368), t("Warminster", "PA", 40.2065, -75.0907),
  t("Willow Grove", "PA", 40.144, -75.1157), t("Conshohocken", "PA", 40.0793, -75.3016), t("Ambler", "PA", 40.1543, -75.2216),
  t("Souderton", "PA", 40.3115, -75.3257), t("Perkasie", "PA", 40.3715, -75.2907), t("Kennett Square", "PA", 39.8468, -75.7116),
  t("Trenton", "NJ", 40.2206, -74.7597), t("Camden", "NJ", 39.9259, -75.1196), t("Mount Holly", "NJ", 39.9926, -74.7879),
  t("Burlington", "NJ", 40.0712, -74.8649), t("Cherry Hill", "NJ", 39.9348, -75.0307), t("Vineland", "NJ", 39.4864, -75.0257),
  t("Atlantic City", "NJ", 39.3643, -74.4229), t("Toms River", "NJ", 39.9537, -74.1979), t("Lakewood", "NJ", 40.0821, -74.2097),
  t("Princeton", "NJ", 40.3573, -74.6672), t("Hamilton", "NJ", 40.2298, -74.6932), t("Glassboro", "NJ", 39.7029, -75.1118),
  t("Millville", "NJ", 39.4021, -75.0393), t("Pennsauken", "NJ", 39.9568, -75.0585), t("Hammonton", "NJ", 39.6365, -74.8021),
  t("Ocean City", "NJ", 39.2776, -74.5746), t("Wildwood", "NJ", 38.9918, -74.8149), t("Cape May", "NJ", 38.9351, -74.906),
  t("Moorestown", "NJ", 39.969, -74.9488), t("Medford", "NJ", 39.8554, -74.8216), t("Salem", "NJ", 39.5721, -75.4688),
  t("Bridgeton", "NJ", 39.4276, -75.2341), t("Brick", "NJ", 40.0584, -74.1129), t("Freehold", "NJ", 40.2601, -74.2738),
  t("Wilmington", "DE", 39.7459, -75.5466), t("Newark", "DE", 39.6837, -75.7497), t("Dover", "DE", 39.1582, -75.5244),
  t("Middletown", "DE", 39.4496, -75.7163), t("New Castle", "DE", 39.662, -75.5663),
  t("Elkton", "MD", 39.6068, -75.8333), t("Havre de Grace", "MD", 39.5493, -76.0916), t("Chestertown", "MD", 39.209, -76.0661),
];
