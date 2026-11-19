import type { StudioProduct } from "../../shared/studio";
import { C, Frame, SERIF, SIZE, validLine, type Format } from "./Frame";
import { AreaMapView } from "./views/AreaMap";
import { CityTempsView } from "./views/CityTemps";
import { DiscussionView, StormTrackView } from "./views/Discussion";
import { RiskMapView } from "./views/RiskMap";
import { SevenDayView } from "./views/SevenDay";
import { TimelineView } from "./views/Timeline";
import { TotalsMapView } from "./views/Totals";
import { CompareView, DayPlannerView, ImpactsView, NoteView, OddsView } from "./views/More";

export interface ViewProps {
  product: StudioProduct;
  fmt?: Format;
  forecaster?: string;
}

/** Renders any Studio product as one self-contained SVG (also what PNG export rasterizes). */
export function ProductView({ product, fmt = "wide", forecaster = "" }: ViewProps) {
  switch (product.kind) {
    case "sevenDay":
      return <SevenDayView product={product} fmt={fmt} forecaster={forecaster} />;
    case "cityTemps":
      return <CityTempsView product={product} fmt={fmt} forecaster={forecaster} />;
    case "riskMap":
      return <RiskMapView product={product} fmt={fmt} forecaster={forecaster} />;
    case "totalsMap":
      return <TotalsMapView product={product} fmt={fmt} forecaster={forecaster} />;
    case "timeline":
      return <TimelineView product={product} fmt={fmt} forecaster={forecaster} />;
    case "discussion":
      return <DiscussionView product={product} fmt={fmt} forecaster={forecaster} />;
    case "note":
      return <NoteView product={product} fmt={fmt} forecaster={forecaster} />;
    case "impacts":
      return <ImpactsView product={product} fmt={fmt} forecaster={forecaster} />;
    case "dayPlanner":
      return <DayPlannerView product={product} fmt={fmt} forecaster={forecaster} />;
    case "compare":
      return <CompareView product={product} fmt={fmt} forecaster={forecaster} />;
    case "odds":
      return <OddsView product={product} fmt={fmt} forecaster={forecaster} />;
    case "areaMap":
      return <AreaMapView product={product} fmt={fmt} forecaster={forecaster} />;
    case "stormTrack":
      return <StormTrackView product={product} fmt={fmt} forecaster={forecaster} />;
    default: {
      const { w, h } = SIZE[fmt];
      return (
        <Frame fmt={fmt} title={product.title} sub={validLine(product.validFrom, product.validTo)} credit={forecaster ? `Forecast by ${forecaster}` : "SHELLY forecast"}>
          <text x={w / 2} y={h / 2} text-anchor="middle" font-family={SERIF} font-size="48" fill={C.muted}>{product.kind}</text>
        </Frame>
      );
    }
  }
}
