#!/bin/sh

# Check if the correct number of arguments are provided
if [ "$#" -ne 3 ]; then
    echo "Usage: $0 <find_string> <replace_string> <file>"
    exit 1
fi

# Assign the arguments to variables
find_string=$1
replace_string=$2
file=$3

# Use sed to replace the string
# Note the use of '|' as the delimiter instead of '/' because file paths contain '/'
sed -i "s|$find_string|$replace_string|g" "$file"
