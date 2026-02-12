
export interface Stop {
  addr: string;
  lat: number;
  lng: number;
}

export enum RouteType {
  TOWN = 'TOWN',
  VILLAGE = 'VILLAGE'
}

export interface RoadClosure {
  id: string;
  lat: number;
  lng: number;
  radius: number; // in meters
  startDate: string;
  endDate: string;
  note: string;
}

export interface AppState {
  index: number;
  stops: Stop[];
  routeType: RouteType;
  isStarted: boolean;
  isAdmin: boolean;
  lastLat: number | null;
  lastLng: number | null;
  gpsAccuracy: number | null;
}
