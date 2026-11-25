/**
 * Fictional name pools for insurance scenarios: body shops, rental agencies,
 * roads and landmarks for loss locations, and vehicles. Makes and models are
 * real, common passenger vehicles, as any claim file would list them; every
 * business is invented. People come from the shared pools in ../legal/names.ts.
 */

export const BODY_SHOPS = [
  "Fairline Collision Center",
  "Old Quarry Auto Body",
  "Bramble Street Collision",
  "Northcote Paint & Body",
  "Ridgeback Auto Repair",
  "Copper Kettle Collision",
  "Willowmere Body Works",
  "Tanager Auto Body",
] as const;

export const RENTAL_AGENCIES = ["Milepost Car Rental", "Lantern Rent-a-Car", "Sidecar Rentals", "Greenlight Auto Rental"] as const;

/** Roads for loss locations; no commas, so a location reads "<road>, 2 miles past the <landmark>". */
export const ROADS = ["Route 9", "Old Mill Road", "Harbor Parkway", "County Road 12", "Lakeshore Drive", "Route 31", "Ferris Avenue", "Canal Street"] as const;

export const LANDMARKS = [
  "Kessel River bridge",
  "Elm Street exit",
  "Northgate mall entrance",
  "county fairgrounds",
  "Pinecrest rail crossing",
  "Hollis water tower",
  "Dunmore toll plaza",
] as const;

export interface VehicleModel {
  make: string;
  model: string;
}

export const VEHICLES: readonly VehicleModel[] = [
  { make: "Honda", model: "Accord" },
  { make: "Honda", model: "CR-V" },
  { make: "Toyota", model: "Camry" },
  { make: "Toyota", model: "RAV4" },
  { make: "Ford", model: "Escape" },
  { make: "Ford", model: "F-150" },
  { make: "Chevrolet", model: "Malibu" },
  { make: "Chevrolet", model: "Equinox" },
  { make: "Nissan", model: "Altima" },
  { make: "Hyundai", model: "Elantra" },
  { make: "Kia", model: "Sorento" },
  { make: "Subaru", model: "Outback" },
  { make: "Mazda", model: "CX-5" },
  { make: "Jeep", model: "Cherokee" },
  { make: "Volkswagen", model: "Jetta" },
];

/** "2019 Honda Accord". */
export const vehicleLabel = (year: number, v: VehicleModel) => `${year} ${v.make} ${v.model}`;
