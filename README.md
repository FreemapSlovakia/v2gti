# About

Tool for extracting geotagged images from the input video. Video must contain subtitles in format provided by Truecam cameras.

Image is extracted every 5 meters and is geotagged with:

* GPS Latitude and Longitude
* GPS Date and Time stamp
* GPS Image Direction

# Requirements

Node 6

# Installation

```
npm install
```

# Usage

```
node . /path/to/video/file
```

# TODO

* code cleanup
* support for external GPX
