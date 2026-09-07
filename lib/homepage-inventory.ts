import { money, vehicleTitle, type Vehicle } from "./inventory";

export type HomepageVehicle = {
  id: string;
  href: string;
  title: string;
  photo: string;
  price: string;
  mileage: string;
};

export function featuredHomepageVehicles(
  inventory: readonly Vehicle[],
  photoUrl: (path: string) => string,
): HomepageVehicle[] {
  return inventory
    .filter(
      (vehicle) =>
        vehicle.featured &&
        vehicle.status === "available" &&
        Boolean(vehicle.photos[0]?.trim()),
    )
    .map((vehicle) => ({
      id: vehicle.id,
      href: `/inventory/${vehicle.slug}`,
      title: vehicleTitle(vehicle),
      photo: photoUrl(vehicle.photos[0]),
      price: money(vehicle.internet_price),
      mileage: `${vehicle.miles.toLocaleString("en-US")} miles`,
    }));
}
