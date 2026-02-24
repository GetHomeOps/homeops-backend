/**
 * Property Structure Configuration
 *
 * Defines the UI structure for property forms: sections, field keys, and labels.
 * Used by the frontend to render property edit/create forms.
 */

const propertyStructure = {
  identity: {
    label: "Identity",
    sections: [
      {
        id: "identity_address",
        label: "Identity & Address",
        fields: [
          { key: "address", label: "Address" },
          { key: "city", label: "City" },
          { key: "state", label: "State" },
          { key: "zip", label: "ZIP" },
          { key: "county", label: "County" },
          { key: "taxId", label: "Tax / Parcel ID" },
        ],
      },
      {
        id: "ownership_occupancy",
        label: "Ownership & Occupancy",
        fields: [
          { key: "ownerName", label: "Owner Name" },
          { key: "ownerName2", label: "Owner Name 2" },
          { key: "ownerCity", label: "Owner City" },
          { key: "occupantName", label: "Occupant Name" },
          { key: "occupantType", label: "Occupant Type" },
          { key: "ownerPhone", label: "Owner Phone" },
          { key: "phoneToShow", label: "Phone to Show" },
        ],
      },
      {
        id: "general_info",
        label: "General Information",
        fields: [
          { key: "propertyType", label: "Property Type" },
          { key: "subType", label: "Sub Type" },
          { key: "roofType", label: "Roof" },
          { key: "yearBuilt", label: "Year Built" },
        ],
      },
      {
        id: "size_lot",
        label: "Size & Lot",
        fields: [
          { key: "sqFtTotal", label: "Total (ft²)" },
          { key: "sqFtFinished", label: "Finished (ft²)" },
          { key: "sqFtUnfinished", label: "Unfinished (ft²)" },
          { key: "garageSqFt", label: "Garage (ft²)" },
          { key: "totalDwellingSqFt", label: "Total Dwelling (ft²)" },
          { key: "sqFtSource", label: "Source (ft²)" },
          { key: "lotSize", label: "Lot Size" },
          { key: "lotSizeSource", label: "Lot Size Source" },
          { key: "lotDim", label: "Lot Dim" },
          { key: "pricePerSqFt", label: "Price / (ft²)" },
          { key: "totalPricePerSqFt", label: "Total Price / (ft²)" },
        ],
      },
      {
        id: "rooms_baths",
        label: "Rooms & Baths",
        fields: [
          { key: "bedCount", label: "Bedrooms" },
          { key: "bathCount", label: "Bathrooms" },
          { key: "fullBaths", label: "Full Baths" },
          { key: "threeQuarterBaths", label: "3/4 Baths" },
          { key: "halfBaths", label: "Half Baths" },
          { key: "numberOfShowers", label: "Number of Showers" },
          { key: "numberOfBathtubs", label: "Number of Bathtubs" },
        ],
      },
      {
        id: "features_parking",
        label: "Features & Parking",
        fields: [
          { key: "fireplaces", label: "Fireplaces" },
          { key: "fireplaceTypes", label: "Fireplace Type(s)" },
          { key: "basement", label: "Basement" },
          { key: "parkingType", label: "Parking Type" },
          { key: "totalCoveredParking", label: "Total Covered Parking" },
          { key: "totalUncoveredParking", label: "Total Uncovered Parking" },
        ],
      },
      {
        id: "schools",
        label: "Schools",
        fields: [
          { key: "schoolDistrict", label: "School District" },
          { key: "elementarySchool", label: "Elementary" },
          { key: "juniorHighSchool", label: "Junior High" },
          { key: "seniorHighSchool", label: "Senior High" },
          { key: "schoolDistrictWebsites", label: "School District Websites" },
        ],
      },
      {
        id: "listing_dates",
        label: "Listing & Dates",
        fields: [
          { key: "listDate", label: "List Date" },
          { key: "expireDate", label: "Expire Date" },
        ],
      },
    ],
  },

  systems: {
    label: "Systems",
    items: [
      { key: "roof", label: "Roof" },
      { key: "gutters", label: "Gutters" },
      { key: "foundation", label: "Foundation & Structure" },
      { key: "exterior", label: "Exterior" },
      { key: "windows", label: "Windows" },
      { key: "heating", label: "Heating" },
      { key: "ac", label: "Air Conditioning" },
      { key: "waterHeating", label: "Water Heating" },
      { key: "electrical", label: "Electrical" },
      { key: "plumbing", label: "Plumbing" },
      { key: "safety", label: "Safety" },
      { key: "inspections", label: "Inspections" },
    ],
  },

  maintenance: {
    label: "Maintenance",
    items: [
      { key: "schedule_setup", label: "Schedule Setup" },
      { key: "define_tasks", label: "Define Maintenance Tasks" },
      { key: "reminder_intervals", label: "Set Reminder Intervals" },
      { key: "configure_notifications", label: "Configure Notifications" },
    ],
  },
};