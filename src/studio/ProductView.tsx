import type { StudioProduct } from "../../shared/studio";
import { C, Frame, SERIF, SIZE, validLine, type Format } from "./Frame";
import { CityTempsView } from "./views/CityTemps";
import { RiskMapView } from "./views/RiskMap";
import { SevenDayView } from "./views/SevenDay";

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
