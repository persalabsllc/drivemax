import { ImageResponse } from "next/og";
export const size = { width: 512, height: 512 };
export const contentType = "image/png";
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#171d28",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 210,
          fontWeight: 800,
          borderBottom: "48px solid #e63046",
        }}
      >
        DM
      </div>
    ),
    size,
  );
}
