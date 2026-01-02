declare module "react-cytoscapejs" {
  import * as React from "react";

  export type CytoscapeComponentProps = {
    elements?: any;
    style?: React.CSSProperties;
    stylesheet?: any;
    layout?: any;
    cy?: (cy: any) => void;
    className?: string;
    id?: string;
    [key: string]: any;
  };

  const CytoscapeComponent: React.ComponentType<CytoscapeComponentProps>;
  export default CytoscapeComponent;
}