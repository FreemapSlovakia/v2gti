# About

Tool for extracting geotagged images from the input video. Video must contain subtitles in format provided by Truecam cameras.

Image is extracted every 5 meters and is geotagged with:

* GPS Latitude and Longitude
* GPS Date and Time stamp
* GPS Image Direction

The result is suitable for upload to [Mapillary](https://www.mapillary.com/) or [OpenStreetView](http://openstreetview.org/).

# Requirements

Node 6

# Installation

```
npm install
```

# Usage

```
node . -i /path/to/video/file [-d distance] [-o output_directory]
```

Distance defaults to 5 m. Output directory defaults to current directory.

# TODO

* support for external GPX with time offset
