The four static fonts are distributed under the adjacent SIL Open Font License files.

- Montserrat SemiBold and Bold: [Montserrat upstream](https://github.com/JulietaUla/Montserrat/tree/555facfb2a18c72c3c0380f0d9c0f060453a9058/fonts/ttf), revision `555facfb2a18c72c3c0380f0d9c0f060453a9058`.
- Nunito Regular and SemiBold: [Nunito static distribution](https://github.com/google-fonts-bower/nunito-bower/tree/1c4961412df3d6e71012549c249d060839f2ee03), revision `1c4961412df3d6e71012549c249d060839f2ee03`.

The files' internal PostScript names are `Montserrat-SemiBold`, `Montserrat-Bold`, `Nunito-Regular`, and `Nunito-SemiBold`. SwiftUI resolves those names, not the filenames. The package test verifies the files and the iPhone app test verifies registration in a running simulator.
