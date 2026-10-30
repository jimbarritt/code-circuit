class Api::V1::Timelines::HomeController < ApplicationController
  def show
    @statuses = load_statuses
    render json: @statuses
  end

  private

  def load_statuses
    cached_home_statuses
  end

  def cached_home_statuses
    HomeFeed.new(current_account).get(20)
  end
end
