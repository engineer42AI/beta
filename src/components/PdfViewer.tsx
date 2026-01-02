import dynamic from "next/dynamic";

const PdfViewer = dynamic(() => import("./PdfViewer.client"), {
  ssr: false,
});

export default PdfViewer;