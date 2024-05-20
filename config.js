const config = {
    BASE_URL : "http://wipopublish.ipvietnam.gov.vn/wopublish-search/public/ajax/detail/trademarks?id=",
    DATA_PATH : "ID_Trademark.csv",
    RETRY_LIMIT : 3,
    delay : {
        BETWEEN_REQUEST : 200
    },
    string : {
        INTERNAL_SERVER_ERROR : "An unexpected server error has occurred"
    }
}

module.exports = config;