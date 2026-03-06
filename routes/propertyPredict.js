"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const { ensureLoggedIn } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");

const router = new express.Router();

const RENTCAST_API_KEY = process.env.RENTCAST_API_KEY;
const RENTCAST_BASE_URL = "https://api.rentcast.io/v1";

/**
 * Map the RentCast property response into the flat field schema
 * the frontend expects.
 */
function mapRentCastToFields(prop) {
  const features = prop.features ?? {};
  const owner = prop.owner ?? {};
  const mailingAddr = owner.mailingAddress ?? {};
  const taxAssessments = prop.taxAssessments ?? {};

  // Get latest tax assessment value for estimatedValue
  const assessmentYears = Object.keys(taxAssessments)
    .filter((k) => /^\d{4}$/.test(k))
    .map(Number)
    .sort((a, b) => b - a);
  const latestYear = assessmentYears[0];
  const latestAssessment = latestYear ? taxAssessments[String(latestYear)] : null;
  const estimatedValue = latestAssessment?.value ?? null;

  // Owner names from RentCast owner.names array
  const ownerNames = owner.names ?? [];
  const owner1Name = ownerNames[0] ?? "";
  const owner2Name = ownerNames[1] ?? "";

  // Lot size: RentCast returns sq ft as number; format as "X sf"
  const lotSizeSqFt = prop.lotSize;
  let lotSize = "";
  if (lotSizeSqFt != null && Number.isFinite(Number(lotSizeSqFt))) {
    lotSize = `${Number(lotSizeSqFt).toLocaleString()} sf`;
  }

  // Parking: RentCast has garageSpaces and garageType
  const garageSpaces = features.garageSpaces != null ? parseInt(features.garageSpaces, 10) : null;
  const garageType = features.garageType ?? "";
  let parkingType = garageType;
  if (garageType && garageSpaces) {
    parkingType = `${garageType} (${garageSpaces} spaces)`;
  }

  // Basement: RentCast has foundationType which may indicate basement
  const foundationType = features.foundationType ?? "";
  const basement = foundationType || "";

  // Fireplace: RentCast has boolean fireplace and fireplaceType
  const hasFireplace = features.fireplace === true;
  const fireplaces = hasFireplace ? 1 : null;
  const fireplaceTypes = features.fireplaceType ?? "";

  return {
    ownerName: owner1Name || "",
    ownerName2: owner2Name || "",
    ownerCity: mailingAddr.city ?? "",
    taxId: prop.assessorID ?? "",
    addressLine2: prop.addressLine2 ?? "",
    propertyType: prop.propertyType ?? "",
    subType: prop.subdivision ?? "",
    roofType: features.roofType ?? "",
    yearBuilt: prop.yearBuilt ?? null,
    sqFtTotal: prop.squareFootage ?? null,
    sqFtFinished: prop.squareFootage ?? null,
    sqFtUnfinished: null,
    garageSqFt: null,
    totalDwellingSqFt: prop.squareFootage ?? null,
    lotSize,
    bedCount: prop.bedrooms ?? null,
    bathCount: prop.bathrooms ?? null,
    fullBaths: null,
    threeQuarterBaths: null,
    halfBaths: null,
    numberOfShowers: null,
    numberOfBathtubs: null,
    fireplaces,
    fireplaceTypes,
    basement,
    parkingType,
    totalCoveredParking: garageSpaces,
    totalUncoveredParking: null,
    schoolDistrict: "",
    elementarySchool: "",
    juniorHighSchool: "",
    seniorHighSchool: "",
    estimatedValue,
    county: prop.county ?? "",
  };
}

/** POST /property-details — Look up property details from RentCast public records. */
router.post("/property-details", ensureLoggedIn, async function (req, res, next) {
  try {
    if (!RENTCAST_API_KEY) {
      throw new BadRequestError("RentCast API key is not configured");
    }

    const { address, addressLine1, city, state, zip } = req.body ?? {};

    const streetAddress = (addressLine1 || address || "").trim();
    if (!streetAddress) {
      throw new BadRequestError("Street address is required (address or addressLine1)");
    }

    let cityStateZip = "";
    if (city && state) {
      cityStateZip = zip ? `${city}, ${state}, ${zip}` : `${city}, ${state}`;
    } else if (zip) {
      cityStateZip = zip;
    }
    if (!cityStateZip) {
      throw new BadRequestError("City/State or ZIP is required");
    }

    // RentCast expects: "Street, City, State, Zip"
    const fullAddress = `${streetAddress}, ${cityStateZip}`;
    const params = new URLSearchParams({ address: fullAddress });
    const url = `${RENTCAST_BASE_URL}/properties?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "X-Api-Key": RENTCAST_API_KEY,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("RentCast API error:", response.status, errorBody);

      if (response.status === 404 || response.status === 204 || response.status === 400) {
        throw new BadRequestError(
          "Property could not be found. Please verify the address and try again."
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new BadRequestError("RentCast API authentication failed. Please contact support.");
      }
      if (response.status === 429) {
        throw new BadRequestError("RentCast API rate limit reached. Please try again in a few minutes.");
      }
      throw new BadRequestError(
        "Property could not be found. Please verify the address and try again."
      );
    }

    const data = await response.json();

    // Debug: write full RentCast response to file (optional, for troubleshooting)
    const debugPath = path.join(process.cwd(), "rentcast-debug.json");
    try {
      fs.writeFileSync(debugPath, JSON.stringify(data, null, 2), "utf8");
      console.log("RentCast API raw response written to", debugPath);
    } catch (writeErr) {
      console.error("RentCast debug write failed:", writeErr.message);
    }

    // RentCast returns an array of properties
    const properties = Array.isArray(data) ? data : [];
    if (properties.length === 0) {
      throw new BadRequestError(
        "Property could not be found. Please verify the address and try again."
      );
    }

    const prediction = mapRentCastToFields(properties[0]);

    return res.json({
      prediction,
      source: "rentcast",
    });
  } catch (err) {
    if (err instanceof BadRequestError) return next(err);
    console.error("RentCast property lookup error:", err);
    return next(new BadRequestError("Property could not be found. Please verify the address and try again."));
  }
});

module.exports = router;
