const body = JSON.parse(args[0]);
const gpsCoordinates = JSON.parse(args[1]);
const metaDataCoordinates = JSON.parse(args[2]);

/**
 * @typedef {Object} Coordinates
 * @property {number} lat
 * @property {number} lng
 */


function haversineDistance(coord1, coord2) {
    const R = 6371000; // Radius of the Earth in meters
    const toRadians = degrees => degrees * (Math.PI / 180);
   

    const lat1 = toRadians(coord1.lat);
    const lng1 = toRadians(coord1.lng);
    const lat2 = toRadians(coord2.lat);
    const lng2 = toRadians(coord2.lng);
  
 
    const dLat = lat2 - lat1;
    const dLng = lng2 - lng1;

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return R * c; // Distance in meters
}

/**
 * Determines if a point is within a given radius from a center point.
 * @param {Coordinates} center - The center coordinates.
 * @param {Coordinates} point - The point coordinates to check.
 * @param {number} radius - The radius in meters.
 * @returns {boolean} - True if the point is within the radius, false otherwise.
 */
function isWithinRadius(center, point, radius) {
    const distance = haversineDistance(center, point);
  
    return distance <= radius;
}



if (!secrets.MAPS_API) {
  throw Error(
    "GOOGLE_API_KEY environment variable not set for Google API"
  );
}

const apiResponse = await Functions.makeHttpRequest({
  url: `https://www.googleapis.com/geolocation/v1/geolocate?key=${secrets.MAPS_API}`,
  method: "POST",
  data: body
  
});
if (apiResponse.error) {
  throw Error("Request failed", apiResponse.error);
}

const  data  = apiResponse.data;
const cellCoordinates = {lat: data.location.lat, lng: data.location.lng};



if (isWithinRadius(cellCoordinates, gpsCoordinates, data.accuracy) && isWithinRadius(cellCoordinates, metaDataCoordinates, data.accuracy) ) {
    return Functions.encodeUint256(0); //true
} else {
   return Functions.encodeUint256(1); //false
}